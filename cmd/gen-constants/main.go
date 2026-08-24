// Command gen-constants renders the TypeScript mirror of the domain constants
// into the frontend source tree.
//
// Usage:
//
//	go run ./cmd/gen-constants -out web/src/lib/constants.generated.ts
//
// It is also wired into the domain package via a //go:generate directive; the
// canonical entry point remains `make generate`.
package main

import (
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"

	"github.com/sicecep/carelog/internal/tsgen"
)

func main() {
	out := flag.String("out", "", "path to the generated .ts file (required)")
	flag.Parse()

	if *out == "" {
		log.Fatal("gen-constants: -out is required")
	}

	if err := run(*out); err != nil {
		log.Fatalf("gen-constants: %v", err)
	}
}

func run(out string) error {
	if err := os.MkdirAll(filepath.Dir(out), 0o755); err != nil {
		return fmt.Errorf("create output dir: %w", err)
	}
	if err := os.WriteFile(out, tsgen.Render(), 0o644); err != nil {
		return fmt.Errorf("write %s: %w", out, err)
	}
	fmt.Fprintf(os.Stderr, "gen-constants: wrote %s\n", out)
	return nil
}
