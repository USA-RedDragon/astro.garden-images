import imagemin from 'imagemin';
import imageminOptipng from 'imagemin-optipng';
import prettyBytes from 'pretty-bytes';
import { glob } from 'glob';
import sharp from 'sharp';
import path from 'path';
import fs from 'fs/promises';

const origPath = '.';
const galleryPath = 'dist';
const genFullresPath = `${galleryPath}/generated/fullres`;
const genHalfresPath = `${galleryPath}/generated/halfres`;
const genSocialPath = `${galleryPath}/generated/social`;
const otherDataImages = [];
const myDataImages = [];

async function mkdirP(path) {
  try {
    console.log(`[mkdir] ${path}`);
    return await fs.mkdir(path);
  } catch (err) {
    if (err.code !== 'EEXIST') {
      throw err;
    }
  }
}

mkdirP(galleryPath);

console.log('Creating folders');
await mkdirP(galleryPath);
await mkdirP(`${galleryPath}/my-data`);
await mkdirP(`${galleryPath}/other-data`);
await mkdirP(`${galleryPath}/generated`);
await mkdirP(genHalfresPath);
await mkdirP(genFullresPath);
await mkdirP(genSocialPath);
await mkdirP(`${genHalfresPath}/my-data`);
await mkdirP(`${genHalfresPath}/other-data`);
await mkdirP(`${genFullresPath}/my-data`);
await mkdirP(`${genFullresPath}/other-data`);
await mkdirP(`${genSocialPath}/my-data`);
await mkdirP(`${genSocialPath}/other-data`);

// Optimize original pngs
console.log('[My images] Optimizing PNGs');
await imagemin([`${origPath}/my-data/*.png`], {
  destination: `${genFullresPath}/my-data`,
  plugins: [
    imageminOptipng({
      optimizationLevel: 5,
    }),
  ],
});

console.log('[Other images] Optimizing PNGs');
await imagemin([`${origPath}/other-data/*.png`], {
  destination: `${genFullresPath}/other-data`,
  plugins: [
    imageminOptipng({
      optimizationLevel: 5,
    }),
  ],
});

// Reduce to 1/2 size and create jpeg + webp
console.log('[My images] Reduce to 50% and create JPEG+WEBP thumbnails');
glob(`${genFullresPath}/my-data/*.png`, async (err, matches) => {
  if (err) {
    console.error(err);
  } else {
    for (const mat of matches) {
      console.log(`[My images] Modifying ${mat}`);
      const size = (await fs.stat(mat)).size;
      sharp(mat)
        .metadata()
        .then(async ({ width, height }) => {
          sharp(mat)
            .resize(Math.round(width * 0.5))
            .toFormat('jpeg')
            .jpeg({ quality: 80, progressive: true, mozjpeg: true })
            .toFile(`${genHalfresPath}/my-data/${path.parse(mat).name}.jpg`).then((out) => {
              console.log(`${mat} to JPEG - ${prettyBytes(size)} -> ${prettyBytes(out.size)}`);
            }).catch((err) => {
              console.error(err);
            });

          sharp(mat).
            png({ quality: 80, palette: true })
            .resize(1200, 630, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
            .toFile(`${genSocialPath}/my-data/${path.parse(mat).name}.png`).then((out) => {
              console.log(`${mat} to PNG - ${prettyBytes(size)} -> ${prettyBytes(out.size)}`);
            }).catch((err) => {
              console.error(err);
            });

          sharp(mat)
            .resize(Math.round(width * 0.5))
            .toFormat('webp')
            .webp({ quality: 80 })
            .toFile(`${genHalfresPath}/my-data/${path.parse(mat).name}.webp`).then((out) => {
              console.log(`${mat} to WEBP - ${prettyBytes(size)} -> ${prettyBytes(out.size)}`);
            }).catch((err) => {
              console.error(err);
            });

          const imgMeta = JSON.parse(await fs.readFile(`${origPath}/my-data/${path.parse(mat).name}.json`));
          const imgData = {
            width: Math.round(width * 0.5),
            height: Math.round(height * 0.5),
            title: imgMeta.title,
            text: imgMeta.text,
            src: `my-data/${path.parse(mat).name}`,
          };
          myDataImages.push(imgData);

          console.log(`[My data] Writing JSON for ${imgData.src}`);
          await fs.writeFile(`${galleryPath}/${imgData.src}.json`, JSON.stringify(imgData)).catch((err) => {
            console.error(err);
          });

          await fs.writeFile(`${galleryPath}/my-data.json`, JSON.stringify(myDataImages)).catch((err) => {
            console.error(err);
          });
        });
    }
  }
});

console.log('[Other images] Reduce to 50% and create JPEG+WEBP thumbnails');
glob(`${genFullresPath}/other-data/*.png`, async (err, matches) => {
  if (err) {
    console.error(err);
  } else {
    for (const mat of matches) {
      console.log(`[Other images] Modifying ${mat}`);
      const size = (await fs.stat(mat)).size;
      sharp(mat)
        .metadata()
        .then(async ({ width, height }) => {
          sharp(mat)
            .resize(Math.round(width * 0.5))
            .toFormat('jpeg')
            .jpeg({ quality: 80, progressive: true, mozjpeg: true })
            .toFile(`${genHalfresPath}/other-data/${path.parse(mat).name}.jpg`).then((out) => {
              console.log(`${mat} to JPEG - ${prettyBytes(size)} -> ${prettyBytes(out.size)}`);
            }).catch((err) => {
              console.error(err);
            });

          sharp(mat).
            png({ quality: 80, palette: true })
            .resize(1200, 630, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
            .toFile(`${genSocialPath}/other-data/${path.parse(mat).name}.png`).then((out) => {
              console.log(`${mat} to PNG - ${prettyBytes(size)} -> ${prettyBytes(out.size)}`);
            }).catch((err) => {
              console.error(err);
            });

          sharp(mat)
            .resize(Math.round(width * 0.5))
            .toFormat('webp')
            .webp({ quality: 80 })
            .toFile(`${genHalfresPath}/other-data/${path.parse(mat).name}.webp`).then((out) => {
              console.log(`${mat} to WEBP - ${prettyBytes(size)} -> ${prettyBytes(out.size)}`);
            }).catch((err) => {
              console.error(err);
            });

          const imgMeta = JSON.parse(await fs.readFile(`${origPath}/other-data/${path.parse(mat).name}.json`));
          const imgData = {
            width: Math.round(width * 0.5),
            height: Math.round(height * 0.5),
            title: imgMeta.title,
            text: imgMeta.text,
            src: `other-data/${path.parse(mat).name}`,
          };
          otherDataImages.push(imgData);

          console.log(`[Other data] Writing JSON for ${imgData.src}`);
          await fs.writeFile(`${galleryPath}/${imgData.src}.json`, JSON.stringify(imgData)).catch((err) => {
            console.error(err);
          });

          await fs.writeFile(`${galleryPath}/other-data.json`, JSON.stringify(otherDataImages)).catch((err) => {
            console.error(err);
          });
        });
    }
  }
});
