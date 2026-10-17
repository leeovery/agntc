# A still for remove's section: remove acme/team-skills/laravel, the pack's
# row with its folders under each asset folder, and the confirm under it.
#
# Record it, and make art/remove.webp:
#   demo/record.sh remove

Output "demo/out/remove/"
Source "demo/look.tape"
# 11 rows: room for what it shows.
Set Height 471

Hide
Type "demo/world.sh build && demo/world.sh installed && source demo/out/world/profile.sh" Enter
Wait
Show

Type "npx agntc remove acme/team-skills/laravel"
Enter
Wait+Screen /Remove it/
Sleep 600ms

Hide
Escape
Wait
