//go:build ignore

package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
)

var pruneDirs = map[string]bool{".git": true, ".hg": true, ".svn": true, "node_modules": true, ".venv": true, "venv": true, "dist": true, "build": true, "vendor": true}

type finding struct {
	Risk   string `json:"risk"`
	Kind   string `json:"kind"`
	Detail string `json:"detail"`
}
type report struct {
	Repository string           `json:"repository"`
	Branch     any              `json:"branch"`
	Head       string           `json:"head"`
	DirtyPaths int              `json:"dirty_paths"`
	Upstream   any              `json:"upstream"`
	Ahead      any              `json:"ahead"`
	Behind     any              `json:"behind"`
	Base       any              `json:"base"`
	Worktrees  []map[string]any `json:"worktrees"`
	Merged     []string         `json:"merged_branch_candidates"`
	Findings   []finding        `json:"findings"`
	Error      string           `json:"error,omitempty"`
}

func git(repo string, args ...string) (int, string, string) {
	a := append([]string{"-C", repo}, args...)
	c := exec.Command("git", a...)
	out, e := c.Output()
	if e == nil {
		return 0, strings.TrimSpace(string(out)), ""
	}
	if x, ok := e.(*exec.ExitError); ok {
		return x.ExitCode(), strings.TrimSpace(string(out)), strings.TrimSpace(string(x.Stderr))
	}
	return 1, "", e.Error()
}
func nonblank(s string) []string {
	var r []string
	for _, x := range strings.Split(s, "\n") {
		if strings.TrimSpace(x) != "" {
			r = append(r, x)
		}
	}
	return r
}
func discover(root string, max int) []string {
	var repos []string
	filepath.WalkDir(root, func(path string, d os.DirEntry, e error) error {
		if e != nil {
			return nil
		}
		if d.IsDir() {
			rel, _ := filepath.Rel(root, path)
			depth := 0
			if rel != "." {
				depth = len(strings.Split(rel, string(filepath.Separator)))
			}
			if depth > max {
				return filepath.SkipDir
			}
			if _, e := os.Stat(filepath.Join(path, ".git")); e == nil {
				repos = append(repos, path)
				return filepath.SkipDir
			}
			if path != root && (strings.HasPrefix(d.Name(), ".") || pruneDirs[d.Name()]) {
				return filepath.SkipDir
			}
		}
		return nil
	})
	sort.Strings(repos)
	return repos
}
func worktrees(raw string) []map[string]any {
	var out []map[string]any
	cur := map[string]any{}
	flush := func() {
		if len(cur) > 0 {
			out = append(out, cur)
			cur = map[string]any{}
		}
	}
	for _, line := range append(strings.Split(raw, "\n"), "") {
		if line == "" {
			flush()
			continue
		}
		p := strings.SplitN(line, " ", 2)
		v := ""
		if len(p) > 1 {
			v = p[1]
		}
		switch p[0] {
		case "worktree":
			cur["path"] = v
		case "HEAD":
			if len(v) > 12 {
				v = v[:12]
			}
			cur["head"] = v
		case "branch":
			cur["branch"] = strings.TrimPrefix(v, "refs/heads/")
		case "detached", "bare", "locked", "prunable":
			if v == "" {
				cur[p[0]] = true
			} else {
				cur[p[0]] = v
			}
		}
	}
	return out
}
func audit(repo string) report {
	r := report{Repository: repo, Worktrees: []map[string]any{}, Merged: []string{}, Findings: []finding{}}
	code, inside, err := git(repo, "rev-parse", "--is-inside-work-tree")
	if code != 0 || inside != "true" {
		if err == "" {
			err = "Not a Git worktree"
		}
		r.Error = err
		return r
	}
	_, branch, _ := git(repo, "branch", "--show-current")
	_, head, _ := git(repo, "rev-parse", "--short", "HEAD")
	r.Head = head
	_, status, _ := git(repo, "status", "--porcelain=v1", "--branch")
	changes := []string{}
	for _, l := range nonblank(status) {
		if !strings.HasPrefix(l, "##") {
			changes = append(changes, l)
		}
	}
	r.DirtyPaths = len(changes)
	_, wt, _ := git(repo, "worktree", "list", "--porcelain")
	r.Worktrees = worktrees(wt)
	if branch != "" {
		r.Branch = branch
	} else {
		r.Branch = nil
	}
	var upstream any
	var ahead, behind any
	if branch != "" {
		c, u, _ := git(repo, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}")
		if c == 0 {
			upstream = u
			c, d, _ := git(repo, "rev-list", "--left-right", "--count", "@{upstream}...HEAD")
			if c == 0 {
				p := strings.Fields(d)
				if len(p) == 2 {
					var b, a int
					fmt.Sscanf(p[0], "%d", &b)
					fmt.Sscanf(p[1], "%d", &a)
					behind = b
					ahead = a
				}
			}
		}
	}
	r.Upstream = upstream
	r.Ahead = ahead
	r.Behind = behind
	_, base, _ := git(repo, "symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD")
	if base == "" {
		for _, b := range []string{"main", "master", "develop"} {
			if code, _, _ := git(repo, "show-ref", "--verify", "--quiet", "refs/heads/"+b); code == 0 {
				base = b
				break
			}
		}
	}
	if base != "" {
		r.Base = base
		c, m, _ := git(repo, "branch", "--format=%(refname:short)", "--merged", base)
		if c == 0 {
			for _, n := range nonblank(m) {
				if n != branch && n != base {
					r.Merged = append(r.Merged, n)
				}
			}
		}
	} else {
		r.Base = nil
	}
	if branch == "" {
		r.Findings = append(r.Findings, finding{"high", "detached-head", "HEAD " + head + " is detached"})
	}
	if len(changes) > 0 {
		r.Findings = append(r.Findings, finding{"medium", "dirty-tree", fmt.Sprintf("%d changed path(s)", len(changes))})
	}
	if branch != "" && upstream == nil {
		r.Findings = append(r.Findings, finding{"medium", "no-upstream", "Branch " + branch + " has no upstream"})
	}
	if a, ok := ahead.(int); ok && a > 0 {
		r.Findings = append(r.Findings, finding{"medium", "ahead-of-upstream", fmt.Sprintf("%d local-only commit(s)", a)})
	}
	if b, ok := behind.(int); ok && b > 0 {
		r.Findings = append(r.Findings, finding{"low", "behind-upstream", fmt.Sprintf("%d upstream commit(s) not present locally", b)})
	}
	if len(r.Worktrees) > 1 {
		r.Findings = append(r.Findings, finding{"medium", "multiple-worktrees", fmt.Sprintf("%d registered worktree(s)", len(r.Worktrees))})
	}
	for _, w := range r.Worktrees {
		if _, ok := w["detached"]; ok {
			r.Findings = append(r.Findings, finding{"high", "detached-worktree", fmt.Sprint(w["path"])})
		}
		if _, ok := w["prunable"]; ok {
			r.Findings = append(r.Findings, finding{"medium", "prunable-worktree", fmt.Sprint(w["path"])})
		}
	}
	if len(r.Merged) > 0 {
		r.Findings = append(r.Findings, finding{"low", "merged-branch-candidates", fmt.Sprintf("%d branch(es) merged into %s", len(r.Merged), base)})
	}
	return r
}
func main() {
	// Go's flag package stops at the first positional argument; accept the documented
	// Python-compatible form with the path before options by moving it to the end.
	args := os.Args[1:]
	for i, arg := range args {
		if !strings.HasPrefix(arg, "-") {
			args = append(append(append([]string{}, args[:i]...), args[i+1:]...), arg)
			break
		}
	}
	scan := flag.Bool("scan", false, "Discover repositories under path")
	depth := flag.Int("max-depth", 2, "Maximum depth under scan root (default: 2)")
	jsonOut := flag.Bool("json", false, "Emit JSON")
	flag.Usage = func() {
		fmt.Fprintln(os.Stderr, "Usage: go run scripts/git_hygiene_audit.go [--scan] [--max-depth N] [--json] <path>")
	}
	flag.CommandLine.Parse(args)
	if flag.NArg() != 1 {
		flag.Usage()
		os.Exit(2)
	}
	if *depth < 0 {
		fmt.Fprintln(os.Stderr, "--max-depth must be zero or greater")
		os.Exit(2)
	}
	arg := flag.Arg(0)
	if arg == "~" || strings.HasPrefix(arg, "~/") {
		if home, e := os.UserHomeDir(); e == nil {
			arg = filepath.Join(home, strings.TrimPrefix(arg, "~/"))
		}
	}
	target, e := filepath.Abs(arg)
	if e != nil {
		panic(e)
	}
	if resolved, e := filepath.EvalSymlinks(target); e == nil {
		target = resolved
	}
	st, e := os.Stat(target)
	if e != nil || !st.IsDir() {
		fmt.Fprintf(os.Stderr, "Path is not a directory: %s\n", target)
		os.Exit(2)
	}
	repos := []string{target}
	if *scan {
		repos = discover(target, *depth)
	}
	if len(repos) == 0 {
		fmt.Fprintln(os.Stderr, "No Git repositories found in the requested scan scope.")
		os.Exit(1)
	}
	reports := make([]report, 0, len(repos))
	for _, p := range repos {
		reports = append(reports, audit(p))
	}
	if *jsonOut {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		enc.Encode(reports)
		return
	}
	fmt.Println("Git hygiene audit: read-only. No Git state was changed.")
	for _, r := range reports {
		fmt.Printf("\n%s\n", r.Repository)
		if r.Error != "" {
			fmt.Println("  ERROR:", r.Error)
			continue
		}
		b := "DETACHED"
		if x, ok := r.Branch.(string); ok {
			b = x
		}
		fmt.Printf("  HEAD: %s @ %s\n  Dirty paths: %d\n", b, r.Head, r.DirtyPaths)
		up := "none"
		if x, ok := r.Upstream.(string); ok {
			up = x
		}
		fmt.Printf("  Upstream: %s | ahead: %v | behind: %v\n  Worktrees (%d):\n", up, val(r.Ahead), val(r.Behind), len(r.Worktrees))
		for _, w := range r.Worktrees {
			fmt.Printf("    - %v\n", w["path"])
		}
		if len(r.Findings) == 0 {
			fmt.Println("  Findings: none in this read-only audit")
		} else {
			fmt.Println("  Findings:")
			for _, f := range r.Findings {
				fmt.Printf("    - %s: %s - %s\n", strings.ToUpper(f.Risk), f.Kind, f.Detail)
			}
		}
	}
}
func val(v any) any {
	if v == nil {
		return "n/a"
	}
	return v
}
