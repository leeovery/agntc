# A still for list's section: the dashboard once the repos have moved on.
# acme/team-skills's pack and go with v1.3.0 to update to, acme/writing
# pinned to v1.0.0 with newer tags, and the local skill in ~/dev/review.
#
# Record it, and make art/list.webp:
#   demo/record.sh list

Output "demo/out/list/"
Source "demo/look.tape"
# 15 rows: room for what it shows.
Set Height 619

Hide
Type "demo/world.sh build && demo/world.sh installed && demo/world.sh upstream && source demo/out/world/profile.sh" Enter
Wait
Show

Type "npx agntc list"
Enter
Wait+Screen /manage/
Sleep 600ms

Hide
Escape
Wait
