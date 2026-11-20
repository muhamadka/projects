package il.hvac.designer;

import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.pdf.PdfDocument;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.util.ArrayList;
import java.util.List;

/** מעטפת WebView שמריצה את מתכנן המיזוג מתוך ה-assets (עובד ללא חיבור לאינטרנט). */
public class MainActivity extends Activity {
    private static final String APP_URL = "file:///android_asset/index.html";
    private static final int CSS_PAGE_WIDTH = 794;          // רוחב A4 ב-96dpi (פיקסלי CSS)
    private static final int PDF_W = 595, PDF_H = 842, PDF_MARGIN = 28; // נקודות PDF (A4)

    private FrameLayout root;
    private WebView web;
    private WebView pdfWeb;
    private final Handler ui = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        // נדרש כדי שציור ה-WebView ל-PDF יכלול את כל המסמך ולא רק את החלק הנראה
        WebView.enableSlowWholeDocumentDraw();
        root = new FrameLayout(this);
        web = makeWebView();
        web.setWebViewClient(new LinkClient());
        web.addJavascriptInterface(new PdfBridge(), "AndroidPdf");
        web.addJavascriptInterface(new StoreBridge(), "AndroidStore");
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);
        if (state != null) web.restoreState(state);
        else web.loadUrl(APP_URL);
    }

    private WebView makeWebView() {
        WebView w = new WebView(this);
        WebSettings s = w.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        s.setTextZoom(100);
        return w;
    }

    private class LinkClient extends WebViewClient {
        // API 24+ (קיים בזמן ריצה; מקומפל מול API 23 ולכן ללא @Override)
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
            return openExternal(req.getUrl());
        }

        @SuppressWarnings("deprecation")
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            return openExternal(Uri.parse(url));
        }
    }

    /** קישורים חיצוניים (וואטסאפ, מקורות) נפתחים באפליקציה המתאימה. */
    private boolean openExternal(Uri uri) {
        if ("file".equals(uri.getScheme())) return false;
        try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); } catch (Exception ignored) { }
        return true;
    }

    /* ======================= PDF: הדפסה ושיתוף ======================= */

    private class PdfBridge {
        /** מסך ההדפסה של אנדרואיד ("שמירה כ-PDF"). */
        @JavascriptInterface
        public void print(final String jobName) {
            ui.post(new Runnable() {
                @Override
                public void run() {
                    PrintManager pm = (PrintManager) getSystemService(PRINT_SERVICE);
                    String name = (jobName == null || jobName.isEmpty()) ? "HVAC report" : jobName;
                    PrintDocumentAdapter adapter = web.createPrintDocumentAdapter(name);
                    pm.print(name, adapter, new PrintAttributes.Builder()
                            .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
                            .setColorMode(PrintAttributes.COLOR_MODE_COLOR).build());
                }
            });
        }

        /** בונה קובץ PDF מהדוח ומשתף אותו. target = "whatsapp" או "any". */
        @JavascriptInterface
        public void sharePdf(final String name, final String stateJson, final String caption, final String target) {
            ui.post(new Runnable() {
                @Override
                public void run() { buildPdf(name, stateJson, caption, target); }
            });
        }
    }

    private void buildPdf(final String name, final String stateJson, final String caption, final String target) {
        if (pdfWeb != null) return;
        final float density = getResources().getDisplayMetrics().density;
        final int wPx = Math.round(CSS_PAGE_WIDTH * density);
        pdfWeb = makeWebView();
        // ה-WebView הנסתר יושב מאחורי הממשק הראשי (שמכסה אותו)
        root.addView(pdfWeb, 0, new FrameLayout.LayoutParams(wPx, root.getHeight() > 0 ? root.getHeight() : 2000));
        pdfWeb.setWebViewClient(new WebViewClient() {
            boolean started = false;

            @Override
            public void onPageFinished(WebView view, String url) {
                if (started) return;
                started = true;
                pdfWeb.evaluateJavascript("window.__renderPdf(" + JSONObject.quote(stateJson) + ")", new ValueCallback<String>() {
                    @Override
                    public void onReceiveValue(String ignored) {
                        // זמן לפריסה ולטעינת גופנים, ואז מדידה סופית
                        ui.postDelayed(new Runnable() {
                            @Override
                            public void run() { measureAndDraw(name, caption, target, density, wPx); }
                        }, 700);
                    }
                });
            }
        });
        pdfWeb.loadUrl(APP_URL + "?pdf=1");
    }

    private void measureAndDraw(final String name, final String caption, final String target, final float density, final int wPx) {
        pdfWeb.evaluateJavascript("window.__pdfMetrics()", new ValueCallback<String>() {
            @Override
            public void onReceiveValue(String value) {
                try {
                    JSONObject m = new JSONObject(value);
                    final int hPx = (int) Math.ceil(m.getInt("h") * density);
                    JSONArray b = m.getJSONArray("breaks");
                    final List<Integer> breaks = new ArrayList<Integer>();
                    for (int i = 0; i < b.length(); i++) breaks.add((int) Math.round(b.getInt(i) * density));
                    pdfWeb.setLayoutParams(new FrameLayout.LayoutParams(wPx, hPx));
                    ui.postDelayed(new Runnable() {
                        @Override
                        public void run() {
                            try {
                                File f = drawPdf(name, wPx, hPx, breaks);
                                finishPdf(true, null);
                                sendPdf(f, caption, target);
                            } catch (Exception e) {
                                finishPdf(false, e.getMessage());
                            }
                        }
                    }, 600);
                } catch (Exception e) {
                    finishPdf(false, e.getMessage());
                }
            }
        });
    }

    /** מחלק את המסמך לעמודי A4 בנקודות שבירה "בטוחות" (בין כרטיסים, שורות וטבלאות). */
    private File drawPdf(String name, int wPx, int hPx, List<Integer> breaks) throws Exception {
        float contentW = PDF_W - 2 * PDF_MARGIN;
        float scale = contentW / wPx;
        int pageHpx = (int) ((PDF_H - 2 * PDF_MARGIN - 14) / scale);
        List<int[]> pages = new ArrayList<int[]>();
        int start = 0;
        while (start < hPx - 4) {
            int limit = start + pageHpx;
            int end;
            if (limit >= hPx) end = hPx;
            else {
                end = limit;
                for (int i = breaks.size() - 1; i >= 0; i--) {
                    int y = breaks.get(i);
                    if (y <= limit && y > start + pageHpx * 0.45) { end = y; break; }
                }
            }
            pages.add(new int[]{start, end});
            start = end;
        }

        PdfDocument doc = new PdfDocument();
        Paint foot = new Paint(Paint.ANTI_ALIAS_FLAG);
        foot.setColor(Color.GRAY);
        foot.setTextSize(8);
        foot.setTextAlign(Paint.Align.CENTER);
        for (int i = 0; i < pages.size(); i++) {
            int[] pg = pages.get(i);
            PdfDocument.Page page = doc.startPage(new PdfDocument.PageInfo.Builder(PDF_W, PDF_H, i + 1).create());
            Canvas c = page.getCanvas();
            c.save();
            c.translate(PDF_MARGIN, PDF_MARGIN);
            c.clipRect(0, 0, contentW, (pg[1] - pg[0]) * scale);
            c.scale(scale, scale);
            c.translate(0, -pg[0]);
            pdfWeb.draw(c);
            c.restore();
            c.drawText((i + 1) + " / " + pages.size(), PDF_W / 2f, PDF_H - 14, foot);
            doc.finishPage(page);
        }
        File dir = new File(getCacheDir(), "pdf");
        if (!dir.exists()) dir.mkdirs();
        File[] old = dir.listFiles();
        if (old != null) for (File o : old) o.delete();
        String safe = name.replaceAll("[\\\\/:*?\"<>|\\n\\r]", "_").trim();
        if (safe.isEmpty()) safe = "HVAC report";
        File out = new File(dir, safe + ".pdf");
        FileOutputStream fos = new FileOutputStream(out);
        doc.writeTo(fos);
        fos.close();
        doc.close();
        return out;
    }

    private void finishPdf(final boolean ok, final String msg) {
        if (pdfWeb != null) {
            root.removeView(pdfWeb);
            pdfWeb.destroy();
            pdfWeb = null;
        }
        String js = "window.__pdfDone && window.__pdfDone(" + ok + "," + JSONObject.quote(msg == null ? "" : msg) + ")";
        web.evaluateJavascript(js, null);
    }

    private void sendPdf(File f, String caption, String target) {
        Uri uri = Uri.parse("content://" + PdfProvider.AUTHORITY + "/" + Uri.encode(f.getName()));
        Intent send = new Intent(Intent.ACTION_SEND);
        send.setType("application/pdf");
        send.putExtra(Intent.EXTRA_STREAM, uri);
        send.putExtra(Intent.EXTRA_TEXT, caption);
        send.putExtra(Intent.EXTRA_SUBJECT, f.getName());
        send.setClipData(ClipData.newRawUri(f.getName(), uri));
        send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        if ("whatsapp".equals(target)) {
            String[] pkgs = {"com.whatsapp", "com.whatsapp.w4b"};
            for (String p : pkgs) {
                try {
                    Intent i = new Intent(send).setPackage(p);
                    startActivity(i);
                    return;
                } catch (Exception ignored) { }
            }
        }
        try {
            startActivity(Intent.createChooser(send, "שיתוף דוח המיזוג"));
        } catch (Exception e) {
            finishPdf(false, "אין אפליקציה לשיתוף");
        }
    }

    /* ======================= אחסון פרויקטים ======================= */

    /** שמירת פרויקטים באחסון הפנימי של האפליקציה + שיתוף גיבוי. */
    private class StoreBridge {
        private SharedPreferences prefs() { return getSharedPreferences("hvac_projects", MODE_PRIVATE); }

        @JavascriptInterface
        public String getItem(String key) { return prefs().getString(key, null); }

        @JavascriptInterface
        public void setItem(String key, String value) { prefs().edit().putString(key, value).commit(); }

        @JavascriptInterface
        public void share(final String subject, final String text) {
            ui.post(new Runnable() {
                @Override
                public void run() {
                    Intent send = new Intent(Intent.ACTION_SEND);
                    send.setType("text/plain");
                    send.putExtra(Intent.EXTRA_SUBJECT, subject);
                    send.putExtra(Intent.EXTRA_TEXT, text);
                    try { startActivity(Intent.createChooser(send, subject)); } catch (Exception ignored) { }
                }
            });
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }
}
