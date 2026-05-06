package main

import (
	"image"
	"image/color"
	_ "image/gif"
	"image/jpeg"
	_ "image/png"
	"os"

	"golang.org/x/image/draw"
	_ "golang.org/x/image/webp"
)

const thumbnailJPEGQuality = 84

func generateImageThumbnailFile(source string, output string, width int, height int) error {
	width, height = normalizeThumbnailSize(width, height)
	file, err := os.Open(source)
	if err != nil {
		return err
	}
	defer file.Close()

	src, _, err := image.Decode(file)
	if err != nil {
		return err
	}
	dst := resizeImageToThumbnail(src, width, height)
	out, err := os.OpenFile(output, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	encodeErr := jpeg.Encode(out, dst, &jpeg.Options{Quality: thumbnailJPEGQuality})
	closeErr := out.Close()
	if encodeErr != nil {
		return encodeErr
	}
	return closeErr
}

func resizeImageToThumbnail(src image.Image, width int, height int) image.Image {
	bounds := src.Bounds()
	srcWidth := bounds.Dx()
	srcHeight := bounds.Dy()
	if srcWidth <= 0 || srcHeight <= 0 {
		return solidImage(width, maxInt(height, 1))
	}
	if height <= 0 {
		height = maxInt(1, int(float64(srcHeight)*float64(width)/float64(srcWidth)))
	}

	scale := minFloat(float64(width)/float64(srcWidth), float64(height)/float64(srcHeight))
	if scale <= 0 {
		scale = 1
	}
	fitWidth := maxInt(1, int(float64(srcWidth)*scale+0.5))
	fitHeight := maxInt(1, int(float64(srcHeight)*scale+0.5))

	dst := image.NewRGBA(image.Rect(0, 0, width, height))
	draw.Draw(dst, dst.Bounds(), image.NewUniform(color.White), image.Point{}, draw.Src)
	left := (width - fitWidth) / 2
	top := (height - fitHeight) / 2
	target := image.Rect(left, top, left+fitWidth, top+fitHeight)
	draw.CatmullRom.Scale(dst, target, src, bounds, draw.Over, nil)
	return dst
}

func solidImage(width int, height int) image.Image {
	img := image.NewRGBA(image.Rect(0, 0, maxInt(width, 1), maxInt(height, 1)))
	draw.Draw(img, img.Bounds(), image.NewUniform(color.White), image.Point{}, draw.Src)
	return img
}

func maxInt(a int, b int) int {
	if a > b {
		return a
	}
	return b
}

func minFloat(a float64, b float64) float64 {
	if a < b {
		return a
	}
	return b
}
