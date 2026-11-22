package auth

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"golang.org/x/crypto/argon2"
)

// Owner passwords (login revamp, D1). Same argon2id parameters and PHC
// string format as PINs (pin.go), so both secrets share one hashing story
// and one decoder.
//
// Rules follow NIST SP 800-63B: a length floor, a generous ceiling, no
// composition rules ("one uppercase…" pushes people to Password1!), and a
// blocklist of passwords attackers try first.

const (
	// PasswordMinLength is counted in characters, not bytes, so a password in
	// a non-Latin script is not penalised.
	PasswordMinLength = 8
	// PasswordMaxLength bounds the argon2 input. Long enough for any
	// passphrase or password-manager output.
	PasswordMaxLength = 128
)

var (
	// ErrPasswordLength is returned outside PasswordMinLength..PasswordMaxLength.
	ErrPasswordLength = errors.New("auth: password length out of range")
	// ErrPasswordCommon is returned for blocklisted passwords and passwords
	// equal to the user's own email, email name, or phone number.
	ErrPasswordCommon = errors.New("auth: password is too common")
)

// commonPasswords holds the passwords attackers try first: the global top
// lists plus common Indonesian choices. Compared case-insensitively. Kept
// short on purpose — the point is to remove the cheapest guesses, and the
// account lockout bounds the rest.
var commonPasswords = func() map[string]struct{} {
	list := []string{
		// Global top lists.
		"password", "password1", "password12", "password123", "passw0rd",
		"12345678", "123456789", "1234567890", "12341234", "11111111",
		"00000000", "87654321", "123123123", "1q2w3e4r", "1q2w3e4r5t",
		"qwertyui", "qwerty123", "qwertyuiop", "asdfghjk", "asdfasdf",
		"zxcvbnm1", "abcd1234", "abc12345", "aaaaaaaa", "iloveyou",
		"iloveyou1", "sunshine", "princess", "football", "baseball",
		"welcome1", "welcome123", "letmein1", "monkey123", "dragon123",
		"superman", "trustno1", "michael1", "shadow123", "master123",
		"admin123", "administrator", "changeme", "default1", "qazwsxedc",
		"zaq12wsx", "1qaz2wsx", "starwars", "whatever", "freedom1",
		// Common in Indonesia.
		"sayang123", "sayangku", "sayangkamu", "cintaku1", "cinta123",
		"bismillah", "bismillah1", "bismillah123", "alhamdulillah",
		"indonesia", "indonesia1", "indonesia123", "jakarta1", "jakarta123",
		"surabaya", "bandung1", "rahasia1", "rahasia123", "katasandi",
		"katasandi1", "kucing123", "anjing123", "garuda123", "merdeka1",
		"persija1", "persib123", "bobotoh1", "mamapapa", "papamama",
		"keluarga", "keluarga1", "anakku123", "bayiku123", "pengasuh",
		"carelog", "carelog1", "carelog123",
	}
	m := make(map[string]struct{}, len(list))
	for _, p := range list {
		m[p] = struct{}{}
	}
	return m
}()

// ValidatePassword checks length and the blocklist. identities are the
// account's own identifiers (email, phone); a password equal to one of them,
// or to the email's name part, or to the phone's digits, is rejected — it is
// the first thing anyone who knows the account would try.
func ValidatePassword(password string, identities ...string) error {
	n := utf8.RuneCountInString(password)
	if n < PasswordMinLength || n > PasswordMaxLength {
		return ErrPasswordLength
	}
	lower := strings.ToLower(password)
	if _, bad := commonPasswords[lower]; bad {
		return ErrPasswordCommon
	}
	for _, id := range identities {
		for _, variant := range identityVariants(id) {
			if variant != "" && lower == variant {
				return ErrPasswordCommon
			}
		}
	}
	return nil
}

// identityVariants expands one identifier into the forms a person might
// reuse as a password: the whole thing, an email's name part, and a phone's
// digits with and without the Indonesian country code.
func identityVariants(id string) []string {
	id = strings.ToLower(strings.TrimSpace(id))
	if id == "" {
		return nil
	}
	out := []string{id}
	if at := strings.IndexByte(id, '@'); at > 0 {
		out = append(out, id[:at])
	}
	var digits strings.Builder
	for _, r := range id {
		if r >= '0' && r <= '9' {
			digits.WriteRune(r)
		}
	}
	if d := digits.String(); len(d) >= 6 {
		out = append(out, d)
		if strings.HasPrefix(d, "62") {
			out = append(out, "0"+d[2:])
		}
	}
	return out
}

// HashPassword validates and hashes a password into a PHC string. Callers
// pass the account's identities so the self-reference rule is enforced.
func HashPassword(password string, identities ...string) (string, error) {
	if err := ValidatePassword(password, identities...); err != nil {
		return "", err
	}
	return hashArgon2id(password)
}

// HashTemporaryPassword hashes a server-generated temporary password. It
// skips the blocklist (the value is random) but keeps the length rule.
func HashTemporaryPassword(password string) (string, error) {
	n := utf8.RuneCountInString(password)
	if n < PasswordMinLength || n > PasswordMaxLength {
		return "", ErrPasswordLength
	}
	return hashArgon2id(password)
}

func hashArgon2id(secret string) (string, error) {
	salt := make([]byte, argonSaltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("auth: generate salt: %w", err)
	}
	key := argon2.IDKey([]byte(secret), salt, argonTime, argonMemory, argonThreads, argonKeyLen)
	return fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version, argonMemory, argonTime, argonThreads,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(key),
	), nil
}

// VerifyPassword reports whether password matches the encoded hash, in
// constant time. Hashes are interchangeable with PIN hashes in format, so
// the same decoder applies.
func VerifyPassword(password, encoded string) (bool, error) {
	params, salt, want, err := decodePINHash(encoded)
	if err != nil {
		return false, err
	}
	got := argon2.IDKey([]byte(password), salt, params.time, params.memory, params.threads, uint32(len(want)))
	return subtle.ConstantTimeCompare(got, want) == 1, nil
}

// dummyPasswordHash is verified against when the account does not exist, so
// "unknown account" costs the same argon2id work as "wrong password" and the
// two cannot be told apart by timing.
var dummyPasswordHash = func() string {
	h, err := hashArgon2id("carelog-dummy-password-not-a-secret")
	if err != nil {
		panic(fmt.Sprintf("auth: build dummy password hash: %v", err))
	}
	return h
}()

// BurnPasswordCheck performs one argon2id verification whose result is
// discarded. Call it on every login path that would otherwise skip hashing.
func BurnPasswordCheck(password string) {
	_, _ = VerifyPassword(password, dummyPasswordHash)
}

// tempPasswordAlphabet leaves out characters people misread when the admin
// sends the password over WhatsApp: 0/O, 1/l/I.
const tempPasswordAlphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"

// TempPasswordLength gives ~68 bits of entropy over tempPasswordAlphabet.
const TempPasswordLength = 12

// GenerateTemporaryPassword returns a random password for an admin-assisted
// reset (D2). It is shown to the admin once and must be changed on first use.
func GenerateTemporaryPassword() (string, error) {
	buf := make([]byte, TempPasswordLength)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("auth: generate temporary password: %w", err)
	}
	out := make([]byte, TempPasswordLength)
	// 256 is not a multiple of the alphabet size, so reject the biased tail
	// instead of using a plain modulo.
	limit := byte(256 - 256%len(tempPasswordAlphabet))
	for i := 0; i < TempPasswordLength; {
		for _, b := range buf {
			if i == TempPasswordLength {
				break
			}
			if b < limit {
				out[i] = tempPasswordAlphabet[int(b)%len(tempPasswordAlphabet)]
				i++
			}
		}
		if i < TempPasswordLength {
			if _, err := rand.Read(buf); err != nil {
				return "", fmt.Errorf("auth: generate temporary password: %w", err)
			}
		}
	}
	return string(out), nil
}
