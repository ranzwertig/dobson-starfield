"""Bild in Graustufen (Float32, lange Seite max. 1600 px) umwandeln, wie die App es tut.
   python3 scripts/image_to_f32.py foto.jpg /tmp/foto  ->  /tmp/foto.f32 + /tmp/foto.dim"""
import sys
from PIL import Image; import numpy as np
im=Image.open(sys.argv[1]).convert('RGB'); print('orig',im.size)
k=min(1,1600/max(im.size)); im=im.resize((round(im.size[0]*k),round(im.size[1]*k)),Image.LANCZOS)
a=np.asarray(im).astype(np.float32); g=0.299*a[...,0]+0.587*a[...,1]+0.114*a[...,2]
out=sys.argv[2] if len(sys.argv)>2 else '/tmp/foto'
g.astype('<f4').tofile(out+'.f32'); open(out+'.dim','w').write('%d %d'%(im.size[0],im.size[1])); print(im.size, 'bg median',np.median(g),'max',g.max())
