package render

import (
	"image"
	"image/color"
	"math"
)

type StyleProfile struct {
	Dominant       []color.RGBA
	AvgBrightness  float64
	AvgSaturation  float64
	IsDark         bool
	IsWarm         bool
	IsHighContrast bool
}

func AnalyzeStyle(img image.Image) StyleProfile {
	small := scaleNearest(img, 50, 50)
	dom := dominantColors(scaleNearest(img, 100, 100), 5)

	var brightSum, satSum float64
	count := 0
	bounds := small.Bounds()
	for y := bounds.Min.Y; y < bounds.Max.Y; y++ {
		for x := bounds.Min.X; x < bounds.Max.X; x++ {
			r, g, b, _ := small.At(x, y).RGBA()
			rr, gg, bb := uint8(r>>8), uint8(g>>8), uint8(b>>8)
			_, s, v := rgbToHSV(rr, gg, bb)
			brightSum += v
			satSum += s
			count++
		}
	}
	avgB := brightSum / float64(count)
	avgS := satSum / float64(count)

	if len(dom) == 0 {
		return StyleProfile{
			Dominant:      []color.RGBA{{128, 128, 128, 255}},
			AvgBrightness: avgB,
			AvgSaturation: avgS,
			IsDark:        avgB < 110,
		}
	}

	main := dom[0]
	isWarm := main.R > main.B
	isDark := avgB < 110

	maxV, minV := 0.0, 256.0
	for _, c := range dom {
		_, _, v := rgbToHSV(c.R, c.G, c.B)
		if v > maxV {
			maxV = v
		}
		if v < minV {
			minV = v
		}
	}

	return StyleProfile{
		Dominant:       dom,
		AvgBrightness:  avgB,
		AvgSaturation:  avgS,
		IsDark:         isDark,
		IsWarm:         isWarm,
		IsHighContrast: (maxV - minV) > 100,
	}
}

func rgbToHSV(r, g, b uint8) (h, s, v float64) {
	rf, gf, bf := float64(r)/255, float64(g)/255, float64(b)/255
	mx := math.Max(rf, math.Max(gf, bf))
	mn := math.Min(rf, math.Min(gf, bf))
	v = mx * 255
	if mx == 0 {
		s = 0
	} else {
		s = (mx - mn) / mx * 255
	}
	if mx == mn {
		h = 0
	} else {
		switch {
		case mx == rf:
			h = math.Mod(60*((gf-bf)/(mx-mn))+360, 360)
		case mx == gf:
			h = 60*((bf-rf)/(mx-mn)) + 120
		default:
			h = 60*((rf-gf)/(mx-mn)) + 240
		}
	}
	return
}

func scaleNearest(src image.Image, w, h int) *image.RGBA {
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	sb := src.Bounds()
	sw, sh := sb.Dx(), sb.Dy()
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			sx := sb.Min.X + x*sw/w
			sy := sb.Min.Y + y*sh/h
			r, g, b, a := src.At(sx, sy).RGBA()
			dst.SetRGBA(x, y, color.RGBA{
				uint8(r >> 8), uint8(g >> 8), uint8(b >> 8), uint8(a >> 8),
			})
		}
	}
	return dst
}

func dominantColors(img image.Image, k int) []color.RGBA {
	bins := make(map[uint32]int)
	bounds := img.Bounds()
	for y := bounds.Min.Y; y < bounds.Max.Y; y++ {
		for x := bounds.Min.X; x < bounds.Max.X; x++ {
			r, g, b, _ := img.At(x, y).RGBA()
			rr := uint32(r>>8) >> 4
			gg := uint32(g>>8) >> 4
			bb := uint32(b>>8) >> 4
			key := rr<<8 | gg<<4 | bb
			bins[key]++
		}
	}

	type bc struct {
		key   uint32
		count int
	}
	bcs := make([]bc, 0, len(bins))
	for k0, v := range bins {
		bcs = append(bcs, bc{k0, v})
	}
	for i := 1; i < len(bcs); i++ {
		for j := i; j > 0 && bcs[j].count > bcs[j-1].count; j-- {
			bcs[j], bcs[j-1] = bcs[j-1], bcs[j]
		}
	}

	out := make([]color.RGBA, 0, k)
	for i := 0; i < k && i < len(bcs); i++ {
		key := bcs[i].key
		r := uint8((key>>8)&0xF) << 4
		g := uint8((key>>4)&0xF) << 4
		b := uint8(key&0xF) << 4
		out = append(out, color.RGBA{r | 8, g | 8, b | 8, 255})
	}
	return out
}
