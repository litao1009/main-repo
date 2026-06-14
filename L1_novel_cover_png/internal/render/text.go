package render

import (
	"image"
	"image/color"
	"image/draw"
	"math"

	"golang.org/x/image/font"
	"golang.org/x/image/font/opentype"
	"golang.org/x/image/math/fixed"
)

func FitFontSize(tt *opentype.Font, text string, maxW, maxH int) (font.Face, float64) {
	lo, hi := 10.0, float64(maxH)*1.4
	bestSize := lo
	for hi-lo > 0.5 {
		mid := (lo + hi) / 2
		face, err := opentype.NewFace(tt, &opentype.FaceOptions{
			Size: mid, DPI: 72, Hinting: font.HintingFull,
		})
		if err != nil {
			break
		}
		w := measureWidth(face, text)
		m := face.Metrics()
		h := (m.Ascent + m.Descent).Ceil()
		face.Close()
		if w <= maxW && h <= maxH {
			bestSize = mid
			lo = mid + 0.5
		} else {
			hi = mid - 0.5
		}
	}
	face, _ := opentype.NewFace(tt, &opentype.FaceOptions{
		Size: bestSize, DPI: 72, Hinting: font.HintingFull,
	})
	return face, bestSize
}

func FitFontSizeVertical(tt *opentype.Font, text string, maxW, maxH int) (font.Face, float64) {
	runes := []rune(text)
	n := len(runes)
	if n == 0 {
		n = 1
	}

	lo, hi := 10.0, float64(maxW)*1.2
	bestSize := lo
	for hi-lo > 0.5 {
		mid := (lo + hi) / 2
		face, err := opentype.NewFace(tt, &opentype.FaceOptions{
			Size: mid, DPI: 72, Hinting: font.HintingFull,
		})
		if err != nil {
			break
		}
		m := face.Metrics()
		charH := (m.Ascent + m.Descent).Ceil()
		totalH := charH*n + (n-1)*int(float64(charH)*0.12)
		widest := 0
		for _, rn := range runes {
			w := measureWidth(face, string(rn))
			if w > widest {
				widest = w
			}
		}
		face.Close()
		if widest <= maxW && totalH <= maxH {
			bestSize = mid
			lo = mid + 0.5
		} else {
			hi = mid - 0.5
		}
	}
	face, _ := opentype.NewFace(tt, &opentype.FaceOptions{
		Size: bestSize, DPI: 72, Hinting: font.HintingFull,
	})
	return face, bestSize
}

func measureWidth(face font.Face, text string) int {
	d := &font.Drawer{Face: face}
	w := d.MeasureString(text)
	return w.Ceil()
}

func MeasureText(face font.Face, text string) (int, int, int) {
	w := measureWidth(face, text)
	m := face.Metrics()
	return w, m.Ascent.Ceil(), m.Descent.Ceil()
}

func MeasureTextVertical(face font.Face, text string) (int, int, int) {
	runes := []rune(text)
	n := len(runes)
	if n == 0 {
		return 0, 0, 0
	}
	m := face.Metrics()
	charH := (m.Ascent + m.Descent).Ceil()
	spacing := int(float64(charH) * 0.12)
	totalH := charH*n + (n-1)*spacing

	widest := 0
	for _, rn := range runes {
		w := measureWidth(face, string(rn))
		if w > widest {
			widest = w
		}
	}
	return widest, totalH, 0
}

func drawTextAt(dst draw.Image, face font.Face, x, y int, text string, c color.Color) {
	d := &font.Drawer{
		Dst:  dst,
		Src:  image.NewUniform(c),
		Face: face,
		Dot:  fixed.P(x, y),
	}
	d.DrawString(text)
}

func drawTextAtVertical(dst draw.Image, face font.Face, x, y int, text string, c color.Color) {
	runes := []rune(text)
	m := face.Metrics()
	charH := (m.Ascent + m.Descent).Ceil()
	spacing := int(float64(charH) * 0.12)
	cy := y
	for _, rn := range runes {
		s := string(rn)
		w := measureWidth(face, s)
		cx := x - w/2
		d := &font.Drawer{
			Dst:  dst,
			Src:  image.NewUniform(c),
			Face: face,
			Dot:  fixed.P(cx, cy),
		}
		d.DrawString(s)
		cy += charH + spacing
	}
}

func DrawFancyText(
	dst draw.Image,
	face font.Face,
	x, y int,
	text string,
	fill, stroke, glow color.RGBA,
	strokeWidth int,
	glowRadius int,
	shadowDX, shadowDY int,
) {
	bounds := dst.Bounds()
	W, H := bounds.Dx(), bounds.Dy()

	glowLayer := image.NewRGBA(image.Rect(0, 0, W, H))
	drawTextStroked(glowLayer, face, x, y, text, glow, glow, strokeWidth+4)
	blurred := gaussianBlur(glowLayer, glowRadius)
	draw.Draw(dst, bounds, blurred, image.Point{}, draw.Over)

	shadowLayer := image.NewRGBA(image.Rect(0, 0, W, H))
	shadowColor := color.RGBA{0, 0, 0, 160}
	drawTextStroked(shadowLayer, face, x+shadowDX, y+shadowDY, text, shadowColor, shadowColor, strokeWidth)
	shadowBlur := gaussianBlur(shadowLayer, 2)
	draw.Draw(dst, bounds, shadowBlur, image.Point{}, draw.Over)

	mainLayer := image.NewRGBA(image.Rect(0, 0, W, H))
	drawTextStroked(mainLayer, face, x, y, text, fill, stroke, strokeWidth)
	draw.Draw(dst, bounds, mainLayer, image.Point{}, draw.Over)
}

func DrawFancyTextVertical(
	dst draw.Image,
	face font.Face,
	x, y int,
	text string,
	fill, stroke, glow color.RGBA,
	strokeWidth int,
	glowRadius int,
	shadowDX, shadowDY int,
) {
	bounds := dst.Bounds()
	W, H := bounds.Dx(), bounds.Dy()

	glowLayer := image.NewRGBA(image.Rect(0, 0, W, H))
	drawTextStrokedVertical(glowLayer, face, x, y, text, glow, glow, strokeWidth+4)
	blurred := gaussianBlur(glowLayer, glowRadius)
	draw.Draw(dst, bounds, blurred, image.Point{}, draw.Over)

	shadowLayer := image.NewRGBA(image.Rect(0, 0, W, H))
	shadowColor := color.RGBA{0, 0, 0, 160}
	drawTextStrokedVertical(shadowLayer, face, x+shadowDX, y+shadowDY, text, shadowColor, shadowColor, strokeWidth)
	shadowBlur := gaussianBlur(shadowLayer, 2)
	draw.Draw(dst, bounds, shadowBlur, image.Point{}, draw.Over)

	mainLayer := image.NewRGBA(image.Rect(0, 0, W, H))
	drawTextStrokedVertical(mainLayer, face, x, y, text, fill, stroke, strokeWidth)
	draw.Draw(dst, bounds, mainLayer, image.Point{}, draw.Over)
}

func DrawGradientText(
	dst draw.Image,
	face font.Face,
	x, y int,
	text string,
	colorTop, colorBottom, stroke, glow color.RGBA,
	strokeWidth int,
	glowRadius int,
) {
	bounds := dst.Bounds()
	W, H := bounds.Dx(), bounds.Dy()

	glowLayer := image.NewRGBA(image.Rect(0, 0, W, H))
	drawTextStroked(glowLayer, face, x, y, text, glow, glow, strokeWidth+5)
	blurred := gaussianBlur(glowLayer, glowRadius)
	draw.Draw(dst, bounds, blurred, image.Point{}, draw.Over)

	shadowLayer := image.NewRGBA(image.Rect(0, 0, W, H))
	sc := color.RGBA{0, 0, 0, 180}
	drawTextStroked(shadowLayer, face, x+3, y+5, text, sc, sc, strokeWidth)
	shadowBlur := gaussianBlur(shadowLayer, 3)
	draw.Draw(dst, bounds, shadowBlur, image.Point{}, draw.Over)

	strokeLayer := image.NewRGBA(image.Rect(0, 0, W, H))
	drawTextStroked(strokeLayer, face, x, y, text, color.RGBA{0, 0, 0, 0}, stroke, strokeWidth)
	draw.Draw(dst, bounds, strokeLayer, image.Point{}, draw.Over)

	mask := image.NewAlpha(image.Rect(0, 0, W, H))
	d := &font.Drawer{
		Dst:  &alphaImage{mask},
		Src:  image.NewUniform(color.Alpha{255}),
		Face: face,
		Dot:  fixed.P(x, y),
	}
	d.DrawString(text)

	m := face.Metrics()
	yTop := y - m.Ascent.Ceil()
	yBot := y + m.Descent.Ceil()
	if yBot <= yTop {
		yBot = yTop + 1
	}

	for yy := 0; yy < H; yy++ {
		var t float64
		if yy <= yTop {
			t = 0
		} else if yy >= yBot {
			t = 1
		} else {
			t = float64(yy-yTop) / float64(yBot-yTop)
		}
		r := uint8(float64(colorTop.R)*(1-t) + float64(colorBottom.R)*t)
		g := uint8(float64(colorTop.G)*(1-t) + float64(colorBottom.G)*t)
		b := uint8(float64(colorTop.B)*(1-t) + float64(colorBottom.B)*t)
		for xx := 0; xx < W; xx++ {
			a := mask.AlphaAt(xx, yy).A
			if a == 0 {
				continue
			}
			blendOver(dst, xx, yy, color.RGBA{r, g, b, a})
		}
	}
}

func DrawGradientTextVertical(
	dst draw.Image,
	face font.Face,
	x, y int,
	text string,
	colorTop, colorBottom, stroke, glow color.RGBA,
	strokeWidth int,
	glowRadius int,
) {
	bounds := dst.Bounds()
	W, H := bounds.Dx(), bounds.Dy()
	runes := []rune(text)
	if len(runes) == 0 {
		return
	}

	glowLayer := image.NewRGBA(image.Rect(0, 0, W, H))
	drawTextStrokedVertical(glowLayer, face, x, y, text, glow, glow, strokeWidth+5)
	blurred := gaussianBlur(glowLayer, glowRadius)
	draw.Draw(dst, bounds, blurred, image.Point{}, draw.Over)

	shadowLayer := image.NewRGBA(image.Rect(0, 0, W, H))
	sc := color.RGBA{0, 0, 0, 180}
	drawTextStrokedVertical(shadowLayer, face, x+3, y+5, text, sc, sc, strokeWidth)
	shadowBlur := gaussianBlur(shadowLayer, 3)
	draw.Draw(dst, bounds, shadowBlur, image.Point{}, draw.Over)

	strokeLayer := image.NewRGBA(image.Rect(0, 0, W, H))
	drawTextStrokedVertical(strokeLayer, face, x, y, text, color.RGBA{0, 0, 0, 0}, stroke, strokeWidth)
	draw.Draw(dst, bounds, strokeLayer, image.Point{}, draw.Over)

	m := face.Metrics()
	charH := (m.Ascent + m.Descent).Ceil()
	spacing := int(float64(charH) * 0.12)
	totalH := charH*len(runes) + (len(runes)-1)*spacing
	yTop := y
	yBot := y + totalH
	if yBot <= yTop {
		yBot = yTop + 1
	}

	mask := image.NewAlpha(image.Rect(0, 0, W, H))
	cy := y
	for _, rn := range runes {
		s := string(rn)
		w := measureWidth(face, s)
		cx := x - w/2
		md := &font.Drawer{
			Dst:  &alphaImage{mask},
			Src:  image.NewUniform(color.Alpha{255}),
			Face: face,
			Dot:  fixed.P(cx, cy),
		}
		md.DrawString(s)
		cy += charH + spacing
	}

	for yy := 0; yy < H; yy++ {
		var t float64
		if yy <= yTop {
			t = 0
		} else if yy >= yBot {
			t = 1
		} else {
			t = float64(yy-yTop) / float64(yBot-yTop)
		}
		r := uint8(float64(colorTop.R)*(1-t) + float64(colorBottom.R)*t)
		g := uint8(float64(colorTop.G)*(1-t) + float64(colorBottom.G)*t)
		b := uint8(float64(colorTop.B)*(1-t) + float64(colorBottom.B)*t)
		for xx := 0; xx < W; xx++ {
			a := mask.AlphaAt(xx, yy).A
			if a == 0 {
				continue
			}
			blendOver(dst, xx, yy, color.RGBA{r, g, b, a})
		}
	}
}

func blendOver(dst draw.Image, x, y int, src color.RGBA) {
	dr, dg, db, da := dst.At(x, y).RGBA()
	dR, dG, dB, dA := uint32(dr>>8), uint32(dg>>8), uint32(db>>8), uint32(da>>8)
	sA := uint32(src.A)
	if sA == 0 {
		return
	}
	if sA == 255 {
		dst.Set(x, y, src)
		return
	}
	out := func(s, d uint32) uint8 {
		return uint8((s*sA + d*(255-sA)) / 255)
	}
	dst.Set(x, y, color.RGBA{
		out(uint32(src.R), dR),
		out(uint32(src.G), dG),
		out(uint32(src.B), dB),
		uint8(minU32(sA + dA*(255-sA)/255)),
	})
}

func minU32(v uint32) uint32 {
	if v > 255 {
		return 255
	}
	return v
}

type alphaImage struct{ *image.Alpha }

func (a *alphaImage) Set(x, y int, c color.Color) {
	_, _, _, al := c.RGBA()
	a.SetAlpha(x, y, color.Alpha{uint8(al >> 8)})
}

func drawTextStroked(dst draw.Image, face font.Face, x, y int, text string,
	fill, stroke color.RGBA, strokeW int) {
	if strokeW > 0 {
		for dy := -strokeW; dy <= strokeW; dy++ {
			for dx := -strokeW; dx <= strokeW; dx++ {
				if dx*dx+dy*dy > strokeW*strokeW {
					continue
				}
				if dx == 0 && dy == 0 {
					continue
				}
				drawTextAt(dst, face, x+dx, y+dy, text, stroke)
			}
		}
	}
	if fill.A > 0 {
		drawTextAt(dst, face, x, y, text, fill)
	}
}

func drawTextStrokedVertical(dst draw.Image, face font.Face, x, y int, text string,
	fill, stroke color.RGBA, strokeW int) {
	if strokeW > 0 {
		for dy := -strokeW; dy <= strokeW; dy++ {
			for dx := -strokeW; dx <= strokeW; dx++ {
				if dx*dx+dy*dy > strokeW*strokeW {
					continue
				}
				if dx == 0 && dy == 0 {
					continue
				}
				drawTextAtVertical(dst, face, x+dx, y+dy, text, stroke)
			}
		}
	}
	if fill.A > 0 {
		drawTextAtVertical(dst, face, x, y, text, fill)
	}
}

func gaussianBlur(src *image.RGBA, radius int) *image.RGBA {
	if radius <= 0 {
		return src
	}
	tmp := boxBlur(src, radius)
	return boxBlur(tmp, radius)
}

func boxBlur(src *image.RGBA, radius int) *image.RGBA {
	bounds := src.Bounds()
	W, H := bounds.Dx(), bounds.Dy()
	tmp := image.NewRGBA(bounds)
	for y := 0; y < H; y++ {
		for x := 0; x < W; x++ {
			var sr, sg, sb, sa, n int
			x0 := int(math.Max(0, float64(x-radius)))
			x1 := int(math.Min(float64(W-1), float64(x+radius)))
			for xx := x0; xx <= x1; xx++ {
				p := src.RGBAAt(xx, y)
				sr += int(p.R)
				sg += int(p.G)
				sb += int(p.B)
				sa += int(p.A)
				n++
			}
			tmp.SetRGBA(x, y, color.RGBA{
				uint8(sr / n), uint8(sg / n), uint8(sb / n), uint8(sa / n),
			})
		}
	}
	out := image.NewRGBA(bounds)
	for y := 0; y < H; y++ {
		for x := 0; x < W; x++ {
			var sr, sg, sb, sa, n int
			y0 := int(math.Max(0, float64(y-radius)))
			y1 := int(math.Min(float64(H-1), float64(y+radius)))
			for yy := y0; yy <= y1; yy++ {
				p := tmp.RGBAAt(x, yy)
				sr += int(p.R)
				sg += int(p.G)
				sb += int(p.B)
				sa += int(p.A)
				n++
			}
			out.SetRGBA(x, y, color.RGBA{
				uint8(sr / n), uint8(sg / n), uint8(sb / n), uint8(sa / n),
			})
		}
	}
	return out
}
