# A still for init's section: init pack in an empty ~/my-pack, the row
# naming the folder with the files it will create as a tree, and the confirm.
#
# Record it, and make art/init.webp:
#   demo/record.sh init

Output "demo/out/init/"
Source "demo/look.tape"
# 16 rows: room for what it shows.
Set Height 656

Hide
Type "demo/world.sh build && source demo/out/world/profile.sh && mkdir ~/my-pack && cd ~/my-pack" Enter
Wait
Show

Type "npx agntc init pack"
Enter
Wait+Screen /Yes/
Sleep 600ms

Hide
Escape
Wait
