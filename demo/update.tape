# A still for update's section: every install updated once the repos have
# moved on. acme/team-skills's pack and go move to v1.3.0 as one row, Next
# carrying the adds that reach v2.0.0, outside ^1.2.0; acme/writing, pinned
# to v1.0.0, is up to date with v1.1.0 under Next; the local skill in
# ~/dev/review is refreshed; then the tally.
#
# Record it, and make art/update.webp:
#   demo/record.sh update

Output "demo/out/update/"
Source "demo/look.tape"
# 22 rows: room for what it shows.
Set Height 878

Hide
Type "demo/world.sh build && demo/world.sh installed && demo/world.sh upstream && source demo/out/world/profile.sh" Enter
Wait
Show

Type "npx agntc update"
Enter
Wait
Sleep 600ms
