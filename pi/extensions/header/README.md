# header

Replaces Pi's startup header with an `agadir` block-letter logo over a line of
swell, followed by `agadir · pi v<version>`. The version is Pi's own, so it
follows upgrades.

When the terminal is narrower than the logo (29 columns), only the name and
version line is shown. The header is installed in the interactive TUI only.

There is no command to restore the built-in header; remove this extension from
the package filter if you want Pi's default.

## Tests

```sh
node --test pi/extensions/header/*.test.ts
```
