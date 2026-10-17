# The look every tape shares, sourced first: Switchboard's, at 100 × 28.
# agntc lays its output out at most 100 columns wide, so at 100 the header
# and the tally reach the right edge as they would in any wider terminal.
# A still sets a height of its own after it, for what it shows: 37 px a row,
# and 64 more.
#
# Switchboard's 160 columns at 17px are twice the 840 px its README shows
# them at; agntc's 100 are, at 28px.

Set Shell "bash"
Set FontFamily "JetBrains Mono"
Set FontSize 28
Set LetterSpacing 0
Set LineHeight 1
# 100 × 28 cells of 16 × 37 px: the frames' size, 1600 × 1036.
Set Width 1672
Set Height 1100
Set Padding 16
Set CursorBlink false
Set Framerate 30
Set TypingSpeed 45ms
Set Theme { "name": "nord", "background": "#2E3440", "foreground": "#D8DEE9", "cursor": "#2E3440", "selection": "#434C5E", "black": "#3B4252", "red": "#BF616A", "green": "#A3BE8C", "yellow": "#EBCB8B", "blue": "#81A1C1", "magenta": "#B48EAD", "cyan": "#88C0D0", "white": "#E5E9F0", "brightBlack": "#4C566A", "brightRed": "#BF616A", "brightGreen": "#A3BE8C", "brightYellow": "#EBCB8B", "brightBlue": "#81A1C1", "brightMagenta": "#B48EAD", "brightCyan": "#8FBCBB", "brightWhite": "#ECEFF4" }
# The world's prompt, as Wait looks for it on the cursor's line.
Set WaitPattern /❯/
Set WaitTimeout 1m
