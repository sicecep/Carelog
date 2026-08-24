package tsgen_test

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/sicecep/carelog/internal/tsgen"
)

// TestGeneratedFileIsUpToDate fails when the checked-in TypeScript mirror drifts
// from the Go source of truth. If it fires, run `make generate` and commit the
// diff.
func TestGeneratedFileIsUpToDate(t *testing.T) {
	repoRoot := findRepoRoot(t)
	path := filepath.Join(repoRoot, tsgen.RelPath)

	got, err := os.ReadFile(path)
	require.NoError(t, err, "read generated file at %s", path)

	want := tsgen.Render()
	require.Equalf(t, string(want), string(got),
		"%s is out of date with internal/domain — run `make generate`", tsgen.RelPath)
}

// findRepoRoot walks up from this test file to the first directory containing a
// go.mod, so the test runs from any working directory.
func findRepoRoot(t *testing.T) string {
	t.Helper()
	_, thisFile, _, ok := runtime.Caller(0)
	require.True(t, ok, "runtime.Caller failed")
	dir := filepath.Dir(thisFile)
	for {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			t.Fatalf("go.mod not found above %s", filepath.Dir(thisFile))
		}
		dir = parent
	}
}
