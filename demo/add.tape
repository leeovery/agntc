# A still for add's section: add acme/team-skills from an empty project, the
# source's row with the menu asked under it, the pack and go picked.
#
# Record it, and make art/add.webp:
#   demo/record.sh add

Output "demo/out/add/"
Source "demo/look.tape"
# 14 rows: room for what it shows.
Set Height 582

Hide
Type "demo/world.sh build && source demo/out/world/profile.sh" Enter
Wait
Show

Type "npx agntc add acme/team-skills"
Enter
Wait+Screen /Select what to install/
Space
Down
Space
Sleep 600ms

Hide
Escape
Wait
