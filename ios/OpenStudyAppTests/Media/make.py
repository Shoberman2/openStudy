from PIL import Image, ImageDraw, ImageFont
import textwrap
G="/System/Library/Fonts/Supplemental/Georgia.ttf"
H="/System/Library/Fonts/Helvetica.ttc"
def books(path, pages_text, page):
    W,Hh=1179,2556
    im=Image.new("RGB",(W,Hh),(250,248,242)); d=ImageDraw.Draw(im)
    st=ImageFont.truetype(H,46)
    d.text((90,60),"9:41",font=st,fill=(0,0,0)); d.text((W-200,60),"100%",font=st,fill=(0,0,0))
    hf=ImageFont.truetype(H,36)
    t="Atomic Habits"; w=d.textlength(t,font=hf); d.text(((W-w)/2,175),t,font=hf,fill=(120,120,120))
    bf=ImageFont.truetype(G,54)
    y=330
    for para in pages_text:
        for line in textwrap.wrap(para,36):
            d.text((90,y),line,font=bf,fill=(25,25,25)); y+=82
        y+=50
    ff=ImageFont.truetype(H,36)
    t=f"Page {page} of 280"; w=d.textlength(t,font=ff); d.text(((W-w)/2,Hh-170),t,font=ff,fill=(120,120,120))
    im.save(path)
p1=["Habits are the compound interest of self-improvement. The same way that money multiplies through compound interest, the effects of your habits multiply as you repeat them.",
    "They seem to make little difference on any given day and yet the impact they deliver over the months and years can be enormous. It is only when looking back two, five, or perhaps ten years later that the value of good habits becomes strikingly apparent."]
p2=["You do not rise to the level of your goals. You fall to the level of your systems. Goals are about the results you want to achieve. Systems are about the processes that lead to those results.",
    "If you want better results, then forget about setting goals. Focus on your system instead. The purpose of setting goals is to win the game, while the purpose of building systems is to continue playing the game."]
p3=["True behavior change is identity change. You might start a habit because of motivation, but the only reason you will stick with one is that it becomes part of your identity.",
    "Every action you take is a vote for the type of person you wish to become. No single instance will transform your beliefs, but as the votes build up, so does the evidence of your new identity."]
books("book_p12.png",p1,12); books("book_p13.png",p2,13); books("book_p14.png",p3,14)
import shutil; shutil.copy("book_p12.png","book_p12_copy.png")
Image.open("book_p13.png").convert("RGB").save("book_p13_reencoded.jpg",quality=85)
# whiteboard
im=Image.new("RGB",(2000,1400),(236,238,234)); d=ImageDraw.Draw(im)
f=ImageFont.truetype("/System/Library/Fonts/Supplemental/Bradley Hand Bold.ttf",80)
lines=["Photosynthesis","- light reactions happen in the thylakoid membranes","- the Calvin cycle fixes carbon dioxide into sugar","- chlorophyll absorbs red and blue light","- oxygen is released as a by-product of splitting water"]
y=120
for i,l in enumerate(lines):
    d.text((120,y),l,font=ImageFont.truetype("/System/Library/Fonts/Supplemental/Bradley Hand Bold.ttf",110 if i==0 else 72),fill=(20,40,120)); y+=230 if i==0 else 200
im.save("whiteboard.jpg",quality=90)
# vocab
im=Image.new("RGB",(1179,2556),(255,255,255)); d=ImageDraw.Draw(im)
d.text((90,250),"Vocab",font=ImageFont.truetype(H,90),fill=(0,0,0))
v=["ephemeral - lasting a very short time","laconic - using very few words","obsequious - too eager to please","sonder - realizing others have full lives","petrichor - the smell of rain on dry earth"]
y=430
for l in v:
    for line in textwrap.wrap(l,30):
        d.text((90,y),line,font=ImageFont.truetype(H,58),fill=(0,0,0)); y+=80
    y+=40
im.save("vocab.png")
# no text
im=Image.new("RGB",(2000,1400)); d=ImageDraw.Draw(im)
for y in range(1400): d.line([(0,y),(2000,y)],fill=(80+y//10,140,200-y//12))
d.ellipse((700,400,1300,1000),fill=(240,200,90))
im.save("landscape.jpg",quality=90)
