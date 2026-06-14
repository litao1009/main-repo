package main

import (
	"flag"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	_ "image/jpeg"
	"image/png"
	"log"
	"os"
	"path/filepath"
	"strings"

	"example.com/novelcover-pure/internal/render"

	"github.com/nfnt/resize"
	"golang.org/x/image/font/opentype"
)

const (
	CanvasW            = 600
	CanvasH            = 800
	HorizontalMaxChars = 8
	MinFontSizeForHz   = 22.0
)

func main() {
	var (
		imagePath   = flag.String("image", "", "input image path (required)")
		nvlName     = flag.String("name", "", "novel name (required)")
		nvlWriter   = flag.String("writer", "", "author name (required)")
		outPath     = flag.String("out", "out.png", "output path with filename")
		titleRatio  = flag.Float64("title-ratio", 0.15, "title region height ratio of canvas")
		writerRatio = flag.Float64("writer-ratio", 0.05, "writer region height ratio of canvas")
		fontsDir    = flag.String("fonts", "fonts", "fonts directory")
	)
	flag.Parse()

	if *imagePath == "" || *nvlName == "" || *nvlWriter == "" {
		flag.Usage()
		log.Fatal("missing required arguments")
	}

	if err := RenderNovelCover(*imagePath, *nvlName, *nvlWriter, *outPath,
		*titleRatio, *writerRatio, *fontsDir); err != nil {
		log.Fatalf("render failed: %v", err)
	}
	abs, _ := filepath.Abs(*outPath)
	st, _ := os.Stat(abs)
	fmt.Println("render success")
	fmt.Println("  output:", abs)
	if st != nil {
		fmt.Printf("  size:   %d bytes\n", st.Size())
	}
}

type LayoutMode int

const (
	LayoutHorizontal LayoutMode = iota
	LayoutVertical
)

func RenderNovelCover(imagePath, nvlName, nvlWriter, outPath string,
	titleRatio, writerRatio float64, fontsDir string) error {

	if outPath == "" || strings.HasSuffix(outPath, "/") || strings.HasSuffix(outPath, "\\") {
		return fmt.Errorf("output must include filename: %s", outPath)
	}
	ext := strings.ToLower(filepath.Ext(outPath))
	if ext != ".png" {
		return fmt.Errorf("only .png output is supported, got: %s", ext)
	}

	f, err := os.Open(imagePath)
	if err != nil {
		return fmt.Errorf("open input image failed: %w", err)
	}
	defer f.Close()
	src, _, err := image.Decode(f)
	if err != nil {
		return fmt.Errorf("decode failed: %w", err)
	}
	if src.Bounds().Dx() != CanvasW || src.Bounds().Dy() != CanvasH {
		src = resize.Resize(CanvasW, CanvasH, src, resize.Lanczos3)
	}

	canvas := image.NewRGBA(image.Rect(0, 0, CanvasW, CanvasH))
	draw.Draw(canvas, canvas.Bounds(), src, src.Bounds().Min, draw.Src)

	style := render.AnalyzeStyle(canvas)
	fmt.Printf("[style] dark=%v warm=%v sat=%.0f bright=%.0f\n",
		style.IsDark, style.IsWarm, style.AvgSaturation, style.AvgBrightness)

	fontFile, fontCat := pickFont(style, fontsDir)
	fmt.Printf("[style] font=%s (%s)\n", filepath.Base(fontFile), fontCat)
	tt, err := loadFont(fontFile)
	if err != nil {
		return fmt.Errorf("load font failed: %w", err)
	}
	fill, stroke, glow := pickColor(style)

	layoutMode := decideLayout(tt, nvlName, titleRatio)
	fmt.Printf("[layout] mode=%s name_len=%d\n",
		map[LayoutMode]string{LayoutHorizontal: "horizontal", LayoutVertical: "vertical"}[layoutMode], len([]rune(nvlName)))

	switch layoutMode {
	case LayoutHorizontal:
		renderHorizontal(canvas, tt, nvlName, nvlWriter, fill, stroke, glow, titleRatio, writerRatio)
	case LayoutVertical:
		renderVertical(canvas, tt, nvlName, nvlWriter, fill, stroke, glow, titleRatio, writerRatio)
	}

	abs, _ := filepath.Abs(outPath)
	if err := os.MkdirAll(filepath.Dir(abs), 0755); err != nil {
		return err
	}
	out, err := os.Create(abs)
	if err != nil {
		return err
	}
	defer out.Close()
	return png.Encode(out, canvas)
}

func decideLayout(tt *opentype.Font, name string, titleRatio float64) LayoutMode {
	useTitleRatio := titleRatio
	if useTitleRatio <= 0 {
		useTitleRatio = 0.15
	}
	runes := []rune(name)

	regionW := int(float64(CanvasW) * 0.90)
	regionH := int(float64(CanvasH) * useTitleRatio)

	tFace, tSize := render.FitFontSize(tt, name, regionW, regionH)
	tFace.Close()

	if tSize >= MinFontSizeForHz && len(runes) <= HorizontalMaxChars {
		return LayoutHorizontal
	}
	return LayoutVertical
}

func renderHorizontal(
	canvas draw.Image,
	tt *opentype.Font,
	name, writer string,
	fill, stroke, glow color.RGBA,
	titleRatio, writerRatio float64,
) {
	useTitleRatio := titleRatio
	if useTitleRatio <= 0 {
		useTitleRatio = 0.15
	}
	useWriterRatio := writerRatio
	if useWriterRatio <= 0 {
		useWriterRatio = 0.05
	}

	bottomRegionTop := int(float64(CanvasH) * 0.78)
	titleMaxH := int(float64(CanvasH) * useTitleRatio)
	titleRegionW := int(float64(CanvasW) * 0.90)

	titleFace, _ := render.FitFontSize(tt, name, titleRegionW, titleMaxH)
	defer titleFace.Close()

	tw, ta, td := render.MeasureText(titleFace, name)
	titleX := (CanvasW - tw) / 2
	titleY := bottomRegionTop + ta + (titleMaxH-(ta+td))/2

	colorTop := fill
	colorBottom := color.RGBA{
		uint8(float64(fill.R) * 0.55),
		uint8(float64(fill.G) * 0.55),
		uint8(float64(fill.B) * 0.55),
		255,
	}
	render.DrawGradientText(canvas, titleFace, titleX, titleY, name,
		colorTop, colorBottom, stroke, glow,
		max(2, (ta+td)/18),
		max(6, (ta+td)/8))

	writerMaxH := int(float64(CanvasH) * useWriterRatio)
	writerRegionW := int(float64(titleRegionW) * 0.6)
	writerFace, _ := render.FitFontSize(tt, writer, writerRegionW, writerMaxH)
	defer writerFace.Close()

	ww, wa, wd := render.MeasureText(writerFace, writer)
	writerX := (CanvasW - ww) / 2
	gap := int(float64(CanvasH) * 0.025)
	writerY := titleY + td + gap + wa
	if writerY+wd > int(float64(CanvasH)*0.97) {
		writerY = int(float64(CanvasH)*0.97) - wd
	}
	render.DrawFancyText(canvas, writerFace, writerX, writerY, writer,
		fill, stroke, glow,
		max(1, (wa+wd)/22),
		4, 2, 3)
}

func renderVertical(
	canvas draw.Image,
	tt *opentype.Font,
	name, writer string,
	fill, stroke, glow color.RGBA,
	titleRatio, writerRatio float64,
) {
	colX := int(float64(CanvasW) * 0.90)
	colW := int(float64(CanvasW) * 0.18)
	nameTopY := int(float64(CanvasH) * 0.08)
	nameMaxH := int(float64(CanvasH) * 0.65)

	titleFace, titleSize := render.FitFontSizeVertical(tt, name, colW, nameMaxH)
	defer titleFace.Close()

	_, titleH, _ := render.MeasureTextVertical(titleFace, name)
	titleStartY := nameTopY + (nameMaxH-titleH)/2

	colorTop := fill
	colorBottom := color.RGBA{
		uint8(float64(fill.R) * 0.55),
		uint8(float64(fill.G) * 0.55),
		uint8(float64(fill.B) * 0.55),
		255,
	}
	render.DrawGradientTextVertical(canvas, titleFace, colX, titleStartY, name,
		colorTop, colorBottom, stroke, glow,
		max(1, int(titleSize)/22),
		max(4, int(titleSize)/10))

	writerMaxH := int(float64(CanvasH) * 0.15)
	writerGap := int(float64(CanvasH) * 0.03)
	writerTop := titleStartY + titleH + writerGap
	writerFace, _ := render.FitFontSizeVertical(tt, writer, colW, writerMaxH)
	defer writerFace.Close()

	_, writerH, _ := render.MeasureTextVertical(writerFace, writer)
	writerStartY := writerTop
	if writerStartY+writerH > int(float64(CanvasH)*0.95) {
		writerStartY = int(float64(CanvasH)*0.95) - writerH
	}

	render.DrawFancyTextVertical(canvas, writerFace, colX, writerStartY, writer,
		fill, stroke, glow,
		max(1, int(titleSize)/28),
		3, 2, 2)
}

func pickFont(s render.StyleProfile, fontsDir string) (string, string) {
	pool := []string{
		"WenQuanYi-Micro-Hei.ttf",
		"WenQuanYi-Micro-Hei-Mono.ttf",
		"PingFang-Medium.ttf",
		"PingFang-Regular.ttf",
		"Songti-Bold.ttf",
		"Songti-Regular.ttf",
	}

	main := s.Dominant[0]
	h, _, v := rgbToHSVInternal(main.R, main.G, main.B)

	var cat string
	switch {
	case s.IsWarm && s.AvgSaturation > 80 && (h < 50 || h > 330):
		cat = "classical"
	case s.IsDark && !s.IsWarm:
		cat = "bold"
	case s.AvgSaturation < 60 && v > 160:
		cat = "soft"
	default:
		cat = "modern"
	}

	for _, fn := range pool {
		p := filepath.Join(fontsDir, fn)
		if _, err := os.Stat(p); err == nil {
			return p, cat
		}
	}
	_ = cat
	entries, _ := os.ReadDir(fontsDir)
	for _, e := range entries {
		if strings.HasSuffix(strings.ToLower(e.Name()), ".ttf") {
			return filepath.Join(fontsDir, e.Name()), "default"
		}
	}
	return "", "none"
}

func pickColor(s render.StyleProfile) (fill, stroke, glow color.RGBA) {
	if s.IsDark {
		if s.IsWarm {
			fill = color.RGBA{255, 215, 120, 255}
			stroke = color.RGBA{60, 25, 10, 255}
			glow = color.RGBA{255, 180, 60, 255}
		} else {
			fill = color.RGBA{230, 240, 255, 255}
			stroke = color.RGBA{15, 20, 50, 255}
			glow = color.RGBA{120, 180, 255, 255}
		}
	} else {
		if s.AvgSaturation > 90 {
			fill = color.RGBA{255, 255, 255, 255}
			stroke = color.RGBA{20, 20, 20, 255}
			glow = color.RGBA{0, 0, 0, 255}
		} else if s.IsWarm {
			fill = color.RGBA{60, 25, 15, 255}
			stroke = color.RGBA{255, 240, 220, 255}
			glow = color.RGBA{180, 100, 50, 255}
		} else {
			fill = color.RGBA{25, 30, 60, 255}
			stroke = color.RGBA{240, 245, 255, 255}
			glow = color.RGBA{80, 110, 180, 255}
		}
	}
	return
}

func loadFont(path string) (*opentype.Font, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	return opentype.Parse(b)
}

func rgbToHSVInternal(r, g, b uint8) (h, s, v float64) {
	rf, gf, bf := float64(r)/255, float64(g)/255, float64(b)/255
	mx, mn := rf, rf
	if gf > mx {
		mx = gf
	}
	if bf > mx {
		mx = bf
	}
	if gf < mn {
		mn = gf
	}
	if bf < mn {
		mn = bf
	}
	v = mx * 255
	if mx == 0 {
		s = 0
	} else {
		s = (mx - mn) / mx * 255
	}
	if mx == mn {
		h = 0
	} else {
		switch mx {
		case rf:
			h = 60 * ((gf - bf) / (mx - mn))
		case gf:
			h = 60*((bf-rf)/(mx-mn)) + 120
		default:
			h = 60*((rf-gf)/(mx-mn)) + 240
		}
		for h < 0 {
			h += 360
		}
	}
	return
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}
