package main

import (
	"fmt"
	"html"
	"strings"
)

func renderDocumentThumbnailSVG(model documentThumbnailModel, width int, height int) string {
	if model.CoverDataURL != "" {
		return renderImageCoverThumbnailSVG(model, width, height)
	}
	if model.Layout == "page" {
		return renderDocumentPageThumbnailSVG(model, width, height)
	}

	accent := nonEmpty(model.Accent, "#7c3aed")
	viewW := float64(width)
	viewH := float64(height)
	contentTop := 68.0
	contentLeft := 22.0
	contentWidth := viewW - 44
	var body strings.Builder

	if len(model.Table) > 0 {
		body.WriteString(renderSVGTable(model.Table, contentLeft, contentTop, contentWidth, viewH-contentTop-20))
	} else {
		body.WriteString(renderSVGLines(model.Lines, contentLeft, contentTop, contentWidth, viewH-contentTop-18))
	}

	return fmt.Sprintf(`<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="0 0 %d %d" role="img" aria-label="%s 缩略图">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="1" stop-color="#f8fafc"/>
    </linearGradient>
    <filter id="shadow" x="-20%%" y="-20%%" width="140%%" height="140%%">
      <feDropShadow dx="0" dy="10" stdDeviation="10" flood-color="#0f172a" flood-opacity="0.16"/>
    </filter>
  </defs>
  <rect width="%d" height="%d" rx="18" fill="#e5e7eb"/>
  <rect x="10" y="8" width="%g" height="%g" rx="14" fill="url(#bg)" filter="url(#shadow)"/>
  <rect x="10" y="8" width="7" height="%g" rx="3.5" fill="%s"/>
  <rect x="22" y="18" width="46" height="24" rx="8" fill="%s" fill-opacity="0.13"/>
  <text x="45" y="34" text-anchor="middle" font-family="Inter, Microsoft YaHei, sans-serif" font-size="11" font-weight="900" fill="%s">%s</text>
  <text x="76" y="28" font-family="Inter, Microsoft YaHei, sans-serif" font-size="14" font-weight="900" fill="#0f172a">%s</text>
  <text x="76" y="45" font-family="Inter, Microsoft YaHei, sans-serif" font-size="10" font-weight="700" fill="#64748b">%s</text>
  %s
</svg>`, width, height, width, height, escapeXML(model.Title), width, height, viewW-20, viewH-16, viewH-16, accent, accent, accent, escapeXML(model.KindLabel), escapeXML(ellipsisRunes(model.Title, 24)), escapeXML(ellipsisRunes(model.Subtitle, 36)), body.String())
}

func renderImageCoverThumbnailSVG(model documentThumbnailModel, width int, height int) string {
	accent := nonEmpty(model.Accent, "#8b5cf6")
	return fmt.Sprintf(`<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="0 0 %d %d" role="img" aria-label="%s 封面缩略图">
  <defs>
    <clipPath id="coverClip"><rect x="0" y="0" width="%d" height="%d" rx="16"/></clipPath>
    <linearGradient id="coverShade" x1="0" y1="0" x2="0" y2="1"><stop offset="0.55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.48"/></linearGradient>
  </defs>
  <rect width="%d" height="%d" rx="16" fill="#111827"/>
  <image x="0" y="0" width="%d" height="%d" preserveAspectRatio="xMidYMid slice" href="%s" clip-path="url(#coverClip)"/>
  <rect width="%d" height="%d" rx="16" fill="url(#coverShade)"/>
  <rect x="12" y="12" width="54" height="24" rx="8" fill="%s" fill-opacity="0.9"/>
  <text x="39" y="29" text-anchor="middle" font-family="Inter, Microsoft YaHei, sans-serif" font-size="11" font-weight="900" fill="#fff">%s</text>
  <text x="16" y="%d" font-family="Inter, Microsoft YaHei, sans-serif" font-size="13" font-weight="900" fill="#fff">%s</text>
</svg>`, width, height, width, height, escapeXML(model.Title), width, height, width, height, width, height, escapeXML(model.CoverDataURL), width, height, accent, escapeXML(model.KindLabel), height-16, escapeXML(ellipsisRunes(model.Title, 30)))
}

func renderDocumentPageThumbnailSVG(model documentThumbnailModel, width int, height int) string {
	accent := nonEmpty(model.Accent, "#2563eb")
	viewW := float64(width)
	viewH := float64(height)
	pageX := viewW * 0.17
	pageY := 13.0
	pageW := viewW * 0.66
	pageH := viewH - 26
	if pageW < 120 {
		pageX = 16
		pageW = viewW - 32
	}
	lineY := pageY + 54
	visible := normalizePreviewLines(model.Lines, 5)
	var lines strings.Builder
	for i, line := range visible {
		y := lineY + float64(i)*16
		if y > pageY+pageH-20 {
			break
		}
		w := pageW - 42 - float64(i%2)*24
		if line != "" {
			lines.WriteString(fmt.Sprintf(`<rect x="%g" y="%g" width="%g" height="5" rx="2.5" fill="#cbd5e1"/>`, pageX+22, y, w))
		}
	}
	return fmt.Sprintf(`<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="0 0 %d %d" role="img" aria-label="%s 文档封面缩略图">
  <defs>
    <filter id="paperShadow" x="-20%%" y="-20%%" width="140%%" height="140%%"><feDropShadow dx="0" dy="10" stdDeviation="8" flood-color="#0f172a" flood-opacity="0.18"/></filter>
  </defs>
  <rect width="%d" height="%d" rx="18" fill="#e7e5df"/>
  <rect x="%g" y="%g" width="%g" height="%g" rx="8" fill="#fffdf8" filter="url(#paperShadow)"/>
  <rect x="%g" y="%g" width="%g" height="6" rx="3" fill="%s"/>
  <text x="%g" y="%g" font-family="Inter, Microsoft YaHei, sans-serif" font-size="15" font-weight="900" fill="#111827">%s</text>
  <text x="%g" y="%g" font-family="Inter, Microsoft YaHei, sans-serif" font-size="9" font-weight="800" fill="#64748b">%s</text>
  %s
  <rect x="%g" y="%g" width="%g" height="18" rx="6" fill="%s" fill-opacity="0.12"/>
  <text x="%g" y="%g" font-family="Inter, Microsoft YaHei, sans-serif" font-size="9" font-weight="900" fill="%s">%s</text>
</svg>`, width, height, width, height, escapeXML(model.Title), width, height, pageX, pageY, pageW, pageH, pageX+22, pageY+22, pageW-44, accent, pageX+22, pageY+42, escapeXML(ellipsisRunes(model.Title, 22)), pageX+22, pageY+56, escapeXML(ellipsisRunes(model.Subtitle, 30)), lines.String(), pageX+22, pageY+pageH-32, 52.0, accent, pageX+32, pageY+pageH-19, accent, escapeXML(model.KindLabel))
}

func renderSVGLines(lines []string, x float64, y float64, width float64, height float64) string {
	visible := normalizePreviewLines(lines, maxDocumentPreviewLines)
	var b strings.Builder
	lineHeight := 15.0
	for i, line := range visible {
		cy := y + float64(i)*lineHeight
		if cy > y+height-8 {
			break
		}
		text := ellipsisRunes(line, maxInt(18, int(width/7)))
		b.WriteString(fmt.Sprintf(`<text x="%g" y="%g" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, Microsoft YaHei, monospace" font-size="10.5" font-weight="700" fill="#334155">%s</text>`, x, cy, escapeXML(text)))
		b.WriteByte('\n')
	}
	return b.String()
}

func renderSVGTable(table [][]string, x float64, y float64, width float64, height float64) string {
	rows := table
	if len(rows) > maxDocumentPreviewLines {
		rows = rows[:maxDocumentPreviewLines]
	}
	if len(rows) == 0 {
		return renderSVGLines([]string{"表格没有可显示的预览行"}, x, y, width, height)
	}
	cols := 0
	for _, row := range rows {
		if len(row) > cols {
			cols = len(row)
		}
	}
	cols = maxInt(1, minInt(cols, maxDocumentPreviewCells))
	cellW := width / float64(cols)
	cellH := minFloat(18, height/float64(maxInt(1, len(rows))))
	var b strings.Builder
	for r, row := range rows {
		for c := 0; c < cols; c++ {
			cx := x + float64(c)*cellW
			cy := y + float64(r)*cellH
			fill := "#ffffff"
			if r == 0 {
				fill = "#eef2ff"
			} else if r%2 == 0 {
				fill = "#f8fafc"
			}
			value := ""
			if c < len(row) {
				value = row[c]
			}
			b.WriteString(fmt.Sprintf(`<rect x="%g" y="%g" width="%g" height="%g" rx="3" fill="%s" stroke="#e2e8f0"/>`, cx, cy, cellW-2, cellH-2, fill))
			b.WriteString(fmt.Sprintf(`<text x="%g" y="%g" font-family="Inter, Microsoft YaHei, sans-serif" font-size="9" font-weight="800" fill="#334155">%s</text>`, cx+5, cy+12, escapeXML(ellipsisRunes(value, maxInt(4, int(cellW/7))))))
		}
	}
	return b.String()
}

func escapeXML(value string) string {
	return html.EscapeString(value)
}

func ellipsisRunes(value string, maxRunes int) string {
	runes := []rune(strings.TrimSpace(value))
	if maxRunes <= 0 || len(runes) <= maxRunes {
		return string(runes)
	}
	if maxRunes <= 1 {
		return "…"
	}
	return string(runes[:maxRunes-1]) + "…"
}
