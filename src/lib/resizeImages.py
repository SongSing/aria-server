from PIL import Image
import os, sys

if __name__ == '__main__':
    images = []

    size = 128

    for f in os.listdir('data/images'):
      if not 'thumb' in str(f):
        images.append(os.path.join('data/images', str(f)))
      if 'thumb.thumb' in str(f):
        os.remove(os.path.join('data/images', str(f)))

    for f in images:
      im = Image.open(f)

      im.thumbnail((size, size))
      im.save(os.path.join('data/images', os.path.splitext(os.path.basename(f))[0]) + '.thumb.png')
