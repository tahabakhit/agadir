# Small shortcuts shared by every machine. Machine-specific ones go in
# ~/.config/shell/local.zsh.

alias ..='cd ..'
alias ...='cd ../..'
alias ....='cd ../../..'
alias g='git'
alias path='print -l ${(s.:.)PATH}'
alias ports='lsof -nP -iTCP -sTCP:LISTEN'
alias sizeof='du -sh'
alias rgs="rg --hidden --glob '!.git' --smart-case --fixed-strings --line-number"
alias rgf="rg --files-with-matches --hidden --glob '!.git' --smart-case --fixed-strings"

# Pi starts in learn mode; needs the pi-learn package.
pi-learn() { command pi --learn=true "$@"; }
