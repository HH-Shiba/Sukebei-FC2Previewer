// offscreen.js - 背景化的 HTML 獲取處理器

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "OFFSCREEN_FETCH") {
    handleOffscreenFetch(msg.url, msg.requiresCookie)
      .then(html => sendResponse({ success: true, html }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // 異步回應
  }
});

async function handleOffscreenFetch(url, requiresCookie = false) {
  try {
    // 設置 cookie（如果需要，例如 FC2 官方）
    if (requiresCookie && url.includes('fc2.com')) {
      document.cookie = "_ac=1; domain=.fc2.com; path=/";
    }

    const response = await fetch(url, {
      credentials: 'include',
      headers: {
        'User-Agent': navigator.userAgent,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();
    
    // 檢查是否為 Cloudflare Challenge 頁面
    if (html.includes('Just a moment...') || html.includes('cf-challenge')) {
      throw new Error('Cloudflare Challenge detected');
    }

    return html;
  } catch (error) {
    console.error('Offscreen fetch failed:', error);
    throw error;
  }
}

console.log('Offscreen document loaded');
