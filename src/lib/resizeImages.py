from PIL import Image
import os, sys

if __name__ == '__main__':
    images = []
    to_remove = []

    size = 128

    for f in os.listdir('data/images'):
      if not 'thumb' in str(f) and not 'full' in str(f):
        images.append(os.path.join('data/images', str(f)))

    for f in images:
      with Image.open(f) as im:
        im.save(os.path.join('data/images', os.path.splitext(os.path.basename(f))[0]) + '.full.png')
        im.thumbnail((size, size))
        im.save(os.path.join('data/images', os.path.splitext(os.path.basename(f))[0]) + '.thumb.png')
      os.remove(f)
