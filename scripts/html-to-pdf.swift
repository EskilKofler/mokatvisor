// Stampa un file HTML in PDF (A4, una o più pagine) con WebKit, il motore di Safari: serve a macOS quando non c'è
// Chrome. Opzionale: scrive anche un PNG per pagina a una data risoluzione e le posizioni dei QR (per controllarli).
//
// Uso:  swift scripts/html-to-pdf.swift entrata.html uscita.pdf [prefisso-png dpi [posizioni.json]]
//
// Ogni elemento .sheet dell'HTML è una pagina (A4, con il margine di 8 mm già dentro il CSS di stampa): qui le pagine
// vengono disegnate una sotto l'altra, poi tagliate e scalate alle dimensioni esatte di un A4 (595,28 × 841,89 pt).
// I PNG si chiamano <prefisso>-1.png, <prefisso>-2.png, …; posizioni.json elenca i .qr in mm (pagina, x, y, lato).
import Cocoa
import WebKit
import PDFKit

let args = CommandLine.arguments
guard args.count >= 3 else {
    FileHandle.standardError.write("uso: html-to-pdf.swift entrata.html uscita.pdf [prefisso-png dpi [posizioni.json]]\n".data(using: .utf8)!)
    exit(2)
}
let htmlURL = URL(fileURLWithPath: args[1])
let pdfURL = URL(fileURLWithPath: args[2])
let pngPrefix = args.count >= 4 ? args[3] : nil
let dpi = args.count >= 5 ? Double(args[4]) ?? 300 : 300
let layoutURL = args.count >= 6 ? URL(fileURLWithPath: args[5]) : nil

let cssPxPerMm = 96.0 / 25.4
let pageW = 210.0 * cssPxPerMm, pageH = 297.0 * cssPxPerMm   // pagina A4 in pixel CSS

func fail(_ msg: String) -> Never {
    FileHandle.standardError.write((msg + "\n").data(using: .utf8)!)
    exit(1)
}

final class Loader: NSObject, WKNavigationDelegate {
    let web: WKWebView
    init(_ web: WKWebView) { self.web = web }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        // Stesso aspetto della stampa: ogni .sheet diventa una pagina di 210 × 297 mm (bordo bianco di 8 mm), una sotto l'altra
        let css = "html,body{margin:0!important;background:#fff!important}.sheet{box-sizing:content-box!important;border:8mm solid #fff!important;margin:0!important;box-shadow:none!important;break-after:auto!important}"
        let js = "var s=document.createElement('style');s.textContent=\(css.debugDescription);document.head.appendChild(s);document.querySelectorAll('.sheet').length;"
        webView.evaluateJavaScript(js) { count, _ in
            let pages = max(1, (count as? Int) ?? 1)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { self.export(pages: pages) }
        }
    }
    func export(pages: Int) {
        // Posizione di ogni .qr (mm): pagina, x, y e lato, dalla pagina vera
        if let layoutURL = layoutURL {
            let js = "JSON.stringify([...document.querySelectorAll('.qr')].map(function(q){var r=q.getBoundingClientRect();return [r.left+scrollX,r.top+scrollY,r.width,r.height];}))"
            web.evaluateJavaScript(js) { v, _ in
                guard let text = v as? String, let raw = try? JSONSerialization.jsonObject(with: text.data(using: .utf8)!) as? [[Double]] else { return }
                let out = raw.map { r -> [String: Double] in
                    let page = floor((r[1] + 1) / pageH)
                    return ["page": page + 1, "x": r[0] / cssPxPerMm, "y": (r[1] - page * pageH) / cssPxPerMm, "w": r[2] / cssPxPerMm, "h": r[3] / cssPxPerMm]
                }
                try? JSONSerialization.data(withJSONObject: out).write(to: layoutURL)
            }
        }
        let totalH = pageH * Double(pages)
        web.frame = CGRect(x: 0, y: 0, width: pageW, height: totalH)
        let cfg = WKPDFConfiguration()
        cfg.rect = CGRect(x: 0, y: 0, width: pageW, height: totalH)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            self.web.createPDF(configuration: cfg) { result in
                switch result {
                case .failure(let e): fail("errore PDF: \(e)")
                case .success(let data): self.finish(data: data, pages: pages)
                }
            }
        }
    }
    func finish(data: Data, pages: Int) {
        guard let doc = PDFDocument(data: data), let page = doc.page(at: 0), let cg = page.pageRef else { fail("PDF vuoto") }
        let a4 = CGRect(x: 0, y: 0, width: 595.2756, height: 841.8898)
        let src = page.bounds(for: .mediaBox)
        let scale = a4.width / pageW
        let out = NSMutableData()
        var box = a4
        guard let consumer = CGDataConsumer(data: out as CFMutableData), let ctx = CGContext(consumer: consumer, mediaBox: &box, nil) else { fail("PDF non scrivibile") }
        for i in 0..<pages {
            // La pagina i è la i-esima fetta dall'alto (in coordinate PDF l'origine è in basso)
            let bottom = src.height - Double(i + 1) * pageH
            ctx.beginPDFPage(nil)
            ctx.saveGState()
            ctx.scaleBy(x: scale, y: scale)
            ctx.clip(to: CGRect(x: 0, y: 0, width: pageW, height: pageH))
            ctx.translateBy(x: 0, y: -bottom)
            ctx.drawPDFPage(cg)
            ctx.restoreGState()
            ctx.endPDFPage()
        }
        ctx.closePDF()
        try? (out as Data).write(to: pdfURL)
        if let prefix = pngPrefix, let final = PDFDocument(data: out as Data) {
            let k = dpi / 72.0
            let w = Int((a4.width * k).rounded()), h = Int((a4.height * k).rounded())
            for i in 0..<final.pageCount {
                guard let p = final.page(at: i),
                      let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: w, pixelsHigh: h, bitsPerSample: 8, samplesPerPixel: 4,
                                                 hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0),
                      let g = NSGraphicsContext(bitmapImageRep: rep) else { continue }
                NSGraphicsContext.saveGraphicsState()
                NSGraphicsContext.current = g
                NSColor.white.setFill()
                NSRect(x: 0, y: 0, width: w, height: h).fill()
                g.cgContext.scaleBy(x: k, y: k)
                p.draw(with: .mediaBox, to: g.cgContext)
                NSGraphicsContext.restoreGraphicsState()
                try? rep.representation(using: .png, properties: [:])?.write(to: URL(fileURLWithPath: "\(prefix)-\(i + 1).png"))
            }
        }
        exit(0)
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
let web = WKWebView(frame: CGRect(x: 0, y: 0, width: pageW, height: pageH))
let loader = Loader(web)
web.navigationDelegate = loader
web.loadFileURL(htmlURL, allowingReadAccessTo: htmlURL.deletingLastPathComponent())
DispatchQueue.main.asyncAfter(deadline: .now() + 60) { fail("timeout") }
app.run()
