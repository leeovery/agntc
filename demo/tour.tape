# The README's lead: agntc's surfaces, a moment on each.
#
# add acme/team-skills, from an empty project: the source's row, the menu
# asked under it, the pack and go picked, then what installed as a tree.
# The repo then tags v1.3.0 (migrations added to the pack, testing removed)
# and v2.0.0. list: the dashboard, both installs with v1.3.0 to update to,
# and the pack's detail view with its actions. update: the spinners, the
# group's row with its move and its members, Next with the adds that reach
# v2.0.0, outside ^1.2.0, and the tally.
#
# Record it, and make art/tour.webp and art/tour.mp4:
#   demo/record.sh tour

Output "demo/out/tour/"
Source "demo/look.tape"

Hide
Type "demo/world.sh build && source demo/out/world/profile.sh" Enter
Wait
Show

Sleep 600ms
Type "npx agntc add acme/team-skills"
Sleep 400ms
Enter
Wait+Screen /Select what to install/
Sleep 1500ms
# The pack, then go.
Space
Sleep 600ms
Down
Sleep 500ms
Space
Sleep 1200ms
Enter
Wait
Sleep 3500ms

Hide
Type '"$DEMO/world.sh" upstream && clear' Enter
Wait
Show

Sleep 600ms
Type "npx agntc list"
Sleep 400ms
Enter
Wait+Screen /manage/
Sleep 2500ms
# The pack's detail view, its actions under it.
Enter
Wait+Screen /Action/
Sleep 3500ms

Hide
Escape
Wait+Screen /manage/
Escape
Wait
Type "clear" Enter
Wait
Show

Sleep 600ms
Type "npx agntc update"
Sleep 400ms
Enter
Wait
Sleep 5s
