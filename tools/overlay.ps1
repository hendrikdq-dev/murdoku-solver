# Dibuja marcas (letras, círculos, aspas, bandas de fila/columna) sobre una imagen del tablero.
# Uso: powershell -NoProfile -ExecutionPolicy Bypass -File tools\overlay.ps1 -spec marcas.json [-image tablero.png]
# El JSON de marcas tiene: out (PNG de salida), board (imagen del tablero, si no se pasa -image),
# grid { ox, oy, cs } (origen del tablero en píxeles y tamaño de casilla), crop [r1,c1,r2,c2], scale,
# rows [{r, fill}], cols [{c, fill}], cells [{r, c, text, small, textColor, fill, border, circle, cross}].
# Colores en hexadecimal RRGGBB o RRGGBBAA. Solo Windows (System.Drawing).
param([string]$spec, [string]$image)
Add-Type -AssemblyName System.Drawing
$J = Get-Content -Raw -Encoding UTF8 $spec | ConvertFrom-Json
$imgPath = if ($image) { $image } elseif ($J.board) { $J.board } else { throw "Falta la imagen del tablero (-image o campo 'board' del JSON)" }
$src = New-Object System.Drawing.Bitmap $imgPath
$ox = [double]$J.grid.ox; $oy = [double]$J.grid.oy; $cs = [double]$J.grid.cs
$r1=[int]$J.crop[0]; $c1=[int]$J.crop[1]; $r2=[int]$J.crop[2]; $c2=[int]$J.crop[3]
$ml=44; $mt=30
$gx=[int]($ox+($c1-1)*$cs); $gy=[int]($oy+($r1-1)*$cs); $gw=[int](($c2-$c1+1)*$cs)+2; $gh=[int](($r2-$r1+1)*$cs)+2
$scale = if ($J.scale) { [double]$J.scale } else { 1.0 }
$W=[int](($gw+$ml+6)*$scale); $H=[int](($gh+$mt+6)*$scale)
$bmp = New-Object System.Drawing.Bitmap $W,$H
$g=[System.Drawing.Graphics]::FromImage($bmp)
$g.InterpolationMode=[System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.SmoothingMode=[System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint=[System.Drawing.Text.TextRenderingHint]::AntiAlias
$g.Clear([System.Drawing.Color]::FromArgb(255,253,250,235))
$g.ScaleTransform($scale,$scale)
$g.DrawImage($src,(New-Object System.Drawing.Rectangle $ml,$mt,$gw,$gh),(New-Object System.Drawing.Rectangle $gx,$gy,$gw,$gh),[System.Drawing.GraphicsUnit]::Pixel)
function CellRect($r,$c){ $x=$ml+($c-$c1)*$cs; $y=$mt+($r-$r1)*$cs; return New-Object System.Drawing.RectangleF $x,$y,$cs,$cs }
function Col($hex){ $hex=$hex.TrimStart('#'); if($hex.Length -eq 8){ return [System.Drawing.Color]::FromArgb([Convert]::ToInt32($hex.Substring(6,2),16),[Convert]::ToInt32($hex.Substring(0,2),16),[Convert]::ToInt32($hex.Substring(2,2),16),[Convert]::ToInt32($hex.Substring(4,2),16)) } else { return [System.Drawing.Color]::FromArgb(255,[Convert]::ToInt32($hex.Substring(0,2),16),[Convert]::ToInt32($hex.Substring(2,2),16),[Convert]::ToInt32($hex.Substring(4,2),16)) } }
$lf = [System.Drawing.Font]::new("Arial",[single]11,[System.Drawing.FontStyle]::Bold)
$lb = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255,90,90,90))
for($r=$r1;$r -le $r2;$r++){ $y=$mt+($r-$r1)*$cs+14; $g.DrawString("R$r",$lf,$lb,2,$y) }
for($c=$c1;$c -le $c2;$c++){ $x=$ml+($c-$c1)*$cs+6; $g.DrawString("C$c",$lf,$lb,$x,6) }
foreach($b in $J.rows){ $rr=[int]$b.r; $rect=New-Object System.Drawing.RectangleF ($ml),($mt+($rr-$r1)*$cs),(($c2-$c1+1)*$cs),$cs; $g.FillRectangle((New-Object System.Drawing.SolidBrush (Col $b.fill)),$rect) }
foreach($b in $J.cols){ $cc=[int]$b.c; $rect=New-Object System.Drawing.RectangleF ($ml+($cc-$c1)*$cs),($mt),$cs,(($r2-$r1+1)*$cs); $g.FillRectangle((New-Object System.Drawing.SolidBrush (Col $b.fill)),$rect) }
$cf = [System.Drawing.Font]::new("Arial",[single]20,[System.Drawing.FontStyle]::Bold)
$sf = [System.Drawing.Font]::new("Arial",[single]9,[System.Drawing.FontStyle]::Bold)
$fmt = New-Object System.Drawing.StringFormat; $fmt.Alignment="Center"; $fmt.LineAlignment="Center"
foreach($cell in $J.cells){ $rect=CellRect ([int]$cell.r) ([int]$cell.c)
  if($cell.fill){ $g.FillRectangle((New-Object System.Drawing.SolidBrush (Col $cell.fill)),$rect) }
  if($cell.border){ $pen=New-Object System.Drawing.Pen (Col $cell.border),3; $g.DrawRectangle($pen,$rect.X+1.5,$rect.Y+1.5,$rect.Width-3,$rect.Height-3) }
  if($cell.circle){ $br=New-Object System.Drawing.SolidBrush (Col $cell.circle); $g.FillEllipse($br,$rect.X+4,$rect.Y+4,$rect.Width-8,$rect.Height-8); $pen=New-Object System.Drawing.Pen ([System.Drawing.Color]::Black),2; $g.DrawEllipse($pen,$rect.X+4,$rect.Y+4,$rect.Width-8,$rect.Height-8) }
  if($cell.text){ $tc=if($cell.textColor){Col $cell.textColor}else{[System.Drawing.Color]::Black}; $font=if($cell.small){$sf}else{$cf}; $g.DrawString([string]$cell.text,$font,(New-Object System.Drawing.SolidBrush $tc),$rect,$fmt) }
  if($cell.cross){ $pen=New-Object System.Drawing.Pen (Col $cell.cross),3; $g.DrawLine($pen,$rect.X+8,$rect.Y+8,$rect.Right-8,$rect.Bottom-8); $g.DrawLine($pen,$rect.X+8,$rect.Bottom-8,$rect.Right-8,$rect.Y+8) }
}
$g.Dispose(); $bmp.Save($J.out,[System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose(); $src.Dispose()
"saved $($J.out)"
