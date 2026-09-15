package auth

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"

	"golang.org/x/crypto/argon2"
)

// PIN hashing for caregiver authentication (AUTH-005).
//
// A 6-digit PIN has only 10^6 possible values. That is acceptable ONLY
// because the PIN is device-bound (possession + knowledge) and online
// attempts are rate-limited — but it means the stored hash must be as
// expensive as practical, so that a database leak does not hand an attacker
// the whole keyspace in seconds. argon2id is memory-hard: it resists the GPU
// and ASIC parallelism that makes bcrypt/PBKDF2 comparatively cheap to
// attack at this keyspace size.

const (
	// PINLength is fixed at 6 digits. Variable-length PINs leak information
	// through the ciphertext length and complicate the UI for the exact
	// users this flow exists to serve.
	PINLength = 6

	// argon2id parameters. ~64MB and 3 passes lands around 50-100ms on the
	// target hardware: unnoticeable during a login, punishing in bulk.
	argonTime    uint32 = 3
	argonMemory  uint32 = 64 * 1024 // KiB
	argonThreads uint8  = 4
	argonKeyLen  uint32 = 32
	argonSaltLen        = 16
)

var (
	// ErrPINFormat is returned when a PIN is not exactly PINLength digits.
	ErrPINFormat = errors.New("auth: pin must be 6 digits")
	// ErrPINWeak is returned for trivially guessable PINs.
	ErrPINWeak = errors.New("auth: pin is too easily guessed")
	// ErrPINHashInvalid is returned when a stored hash cannot be parsed.
	ErrPINHashInvalid = errors.New("auth: stored pin hash is malformed")
)

// weakPINs are the values an attacker tries first. Blocking them costs the
// user almost nothing (they pick another number) and removes the cheapest
// guesses from a keyspace that is already small.
var weakPINs = map[string]struct{}{
	"000000": {}, "111111": {}, "222222": {}, "333333": {}, "444444": {},
	"555555": {}, "666666": {}, "777777": {}, "888888": {}, "999999": {},
	"123456": {}, "654321": {}, "012345": {}, "543210": {}, "121212": {},
	"112233": {}, "123123": {}, "696969": {}, "159753": {}, "147258": {},
	// Not strict arithmetic runs, but the same keypad patterns people
	// actually pick: a leading 0 followed by a descending/ascending run.
	"098765": {}, "987654": {}, "456789": {}, "234567": {}, "345678": {},
	"765432": {}, "876543": {}, "102030": {}, "111222": {}, "123321": {},
}

// ValidatePIN checks shape and obvious weakness. Callers must run this
// before HashPIN so the rules are enforced at set time, not guessed at.
func ValidatePIN(pin string) error {
	if len(pin) != PINLength {
		return ErrPINFormat
	}
	for _, r := range pin {
		if r < '0' || r > '9' {
			return ErrPINFormat
		}
	}
	if _, bad := weakPINs[pin]; bad {
		return ErrPINWeak
	}
	// Straight runs (123456 handled above, but also 234567, 098765…).
	ascending, descending := true, true
	for i := 1; i < len(pin); i++ {
		if pin[i] != pin[i-1]+1 {
			ascending = false
		}
		if pin[i] != pin[i-1]-1 {
			descending = false
		}
	}
	if ascending || descending {
		return ErrPINWeak
	}
	return nil
}

// HashPIN returns an encoded argon2id hash in the standard PHC string
// format, so the parameters travel with the hash and can be raised later
// without invalidating existing PINs.
//
//	$argon2id$v=19$m=65536,t=3,p=4$<b64 salt>$<b64 hash>
func HashPIN(pin string) (string, error) {
	if err := ValidatePIN(pin); err != nil {
		return "", err
	}
	salt := make([]byte, argonSaltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("auth: generate salt: %w", err)
	}
	key := argon2.IDKey([]byte(pin), salt, argonTime, argonMemory, argonThreads, argonKeyLen)
	return fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version, argonMemory, argonTime, argonThreads,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(key),
	), nil
}

// VerifyPIN reports whether pin matches the encoded hash.
//
// Comparison is constant-time: a byte-wise early return would leak how much
// of the hash matched, and timing a few thousand requests is far cheaper
// than brute-forcing even a 6-digit space.
func VerifyPIN(pin, encoded string) (bool, error) {
	params, salt, want, err := decodePINHash(encoded)
	if err != nil {
		return false, err
	}
	got := argon2.IDKey([]byte(pin), salt, params.time, params.memory, params.threads, uint32(len(want)))
	return subtle.ConstantTimeCompare(got, want) == 1, nil
}

type argonParams struct {
	memory  uint32
	time    uint32
	threads uint8
}

func decodePINHash(encoded string) (argonParams, []byte, []byte, error) {
	parts := strings.Split(encoded, "$")
	// ["", "argon2id", "v=19", "m=...,t=...,p=...", salt, hash]
	if len(parts) != 6 || parts[1] != "argon2id" {
		return argonParams{}, nil, nil, ErrPINHashInvalid
	}
	var version int
	if _, err := fmt.Sscanf(parts[2], "v=%d", &version); err != nil || version != argon2.Version {
		return argonParams{}, nil, nil, ErrPINHashInvalid
	}
	var p argonParams
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &p.memory, &p.time, &p.threads); err != nil {
		return argonParams{}, nil, nil, ErrPINHashInvalid
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil {
		return argonParams{}, nil, nil, ErrPINHashInvalid
	}
	key, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil || len(key) == 0 {
		return argonParams{}, nil, nil, ErrPINHashInvalid
	}
	return p, salt, key, nil
}
