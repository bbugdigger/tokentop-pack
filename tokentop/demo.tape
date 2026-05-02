# vhs script for recording a tokentop demo GIF.
#
# Requires (Linux/Mac/WSL): vhs, ttyd, ffmpeg.
#   brew install vhs              # macOS
#   sudo apt install ffmpeg       # Linux
#   go install github.com/tsl0922/ttyd@latest
#
# Then from this directory:
#   vhs demo.tape                 # produces demo.gif
#
# On Windows: ttyd does not have a clean install. Use the demo-feeder script with
# any screen recorder (ScreenToGif, Windows Game Bar Win+G, OBS) instead — see README.

Output demo.gif

Set FontSize 13
Set Width  1100
Set Height 480
Set Padding 8
Set Theme "Dracula"
Set TypingSpeed 30ms

# Reset and prep a temp ledger so the demo doesn't touch the user's real one.
Type 'export DEMO_LEDGER=$(mktemp -t tokentop-demo.XXXXXX.jsonl)'
Enter
Sleep 200ms

# Start the feeder in the background — it streams realistic events for ~35s.
Type 'node scripts/demo-feeder.mjs --ledger $DEMO_LEDGER --reset &'
Enter
Sleep 800ms

# Start tokentop pointed at the demo ledger.
Type 'node --experimental-strip-types src/main.ts --ledger $DEMO_LEDGER'
Enter
Sleep 8s          # Watch sessions appear and tokens climb (sessions view, default).

Type 'm'          # Switch to models view
Sleep 5s

Type 't'          # Switch to tools view
Sleep 5s

Type 's'          # Back to sessions view
Sleep 8s          # Watch the second wave of events

Type 'q'          # Quit cleanly
Sleep 500ms

# Cleanup
Type 'rm $DEMO_LEDGER'
Enter
