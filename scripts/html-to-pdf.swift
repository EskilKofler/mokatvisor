// Stampa un file HTML in PDF (A4, una pagina) con WebKit, il motore di Safari: serve a macOS quando non c'è
// Chrome. Opzionale: scrive anche un PNG della pagina a una data risoluzione (per controllare i QR).
//
// Uso:  swift scripts/html-to-pdf.swift entrata.html uscita.pdf [uscita.png [dpi]]
//
// Il foglio ha il margine di 8 mm dentro il CSS (@page): qui la pagina viene disegnata a 210 × 297 mm con
// lo stesso margine, poi scalata alle dimensioni esatte di un A4 (595,28 × 841,89 pt).
import Cocoa
import WebKit
import PDFKit

let args = CommandLine.arguments
guard args.count >= 3 else {
    FileHandle.standardError.write("uso: html-to-pdf.swift entrata.html uscita.pdf [uscita.png [dpi]]\n".data(using: .utf8)!)
    exit(2)
}
let htmlURL = URL(fileURLWithPath: args[1])
let pdfURL = URL(fileURLWithPath: args[2])
let pngURL = args.count >= 4 ? URL(fileURLWithPath: args[3]) : nil
let dpi = args.count >= 5 ? Double(args[4]) ?? 300 : 300

let cssPxPerMm = 96.0 / 25.4
let pageW = 210.0 * cssPxPerMm, pageH = 297.0 * cssPxPerMm   // pagina A4 in pixel CSS

final class Loader: NSObject, WKNavigationDelegate {
    let web: WKWebView
    init(_ web: WKWebView) { self.web = web }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        // Stesso aspetto della stampa: pagina bianca, foglio a 8 mm dal bordo, niente ombra
        let css = "html,body{margin:0!important;background:#fff!important}.sheet{margin:8mm 0 0 8mm!important;box-shadow:none!important}"
        let js = "var s=document.createElement('style');s.textContent=\(css.debugDescription);document.head.appendChild(s);"
        webView.evaluateJavaScript(js) { _, _ in
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { self.export() }
        }
    }
    func export() {
        let cfg = WKPDFConfiguration()
        cfg.rect = CGRect(x: 0, y: 0, width: pageW, height: pageH)
        web.createPDF(configuration: cfg) { result in
            switch result {
            case .failure(let e):
                FileHandle.standardError.write("errore PDF: \(e)\n".data(using: .utf8)!)
                exit(1)
            case .success(let data):
                guard let doc = PDFDocument(data: data), let page = doc.page(at: 0) else { exit(1) }
                // Scala la pagina alle dimensioni esatte di un A4
                let a4 = CGRect(x: 0, y: 0, width: 595.2756, height: 841.8898)
                let src = page.bounds(for: .mediaBox)
                let out = NSMutableData()
                var box = a4
                guard let consumer = CGDataConsumer(data: out as CFMutableData),
                      let ctx = CGContext(consumer: consumer, mediaBox: &box, nil),
                      let cg = page.pageRef else { exit(1) }
                ctx.beginPDFPage(nil)
                ctx.scaleBy(x: a4.width / src.width, y: a4.height / src.height)
                ctx.drawPDFPage(cg)
                ctx.endPDFPage()
                ctx.closePDF()
                try? (out as Data).write(to: pdfURL)
                if let pngURL = pngURL, let final = PDFDocument(data: out as Data), let p = final.page(at: 0) {
                    let scale = dpi / 72.0
                    let w = Int((a4.width * scale).rounded()), h = Int((a4.height * scale).rounded())
                    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: w, pixelsHigh: h, bitsPerSample: 8,
                                               samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                                               colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
                    let g = NSGraphicsContext(bitmapImageRep: rep)!
                    NSGraphicsContext.saveGraphicsState()
                    NSGraphicsContext.current = g
                    NSColor.white.setFill()
                    NSRect(x: 0, y: 0, width: w, height: h).fill()
                    g.cgContext.scaleBy(x: scale, y: scale)
                    p.draw(with: .mediaBox, to: g.cgContext)
                    NSGraphicsContext.restoreGraphicsState()
                    try? rep.representation(using: .png, properties: [:])?.write(to: pngURL)
                }
                exit(0)
            }
        }
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
let web = WKWebView(frame: CGRect(x: 0, y: 0, width: pageW, height: pageH))
let loader = Loader(web)
web.navigationDelegate = loader
web.loadFileURL(htmlURL, allowingReadAccessTo: htmlURL.deletingLastPathComponent())
DispatchQueue.main.asyncAfter(deadline: .now() + 60) { FileHandle.standardError.write("timeout\n".data(using: .utf8)!); exit(1) }
app.run()
