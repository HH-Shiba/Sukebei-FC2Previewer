chrome.action.onClicked.addListener((tab) => {
  chrome.storage.local.get("sidebarOpen", (result) => {
    let newState = !result.sidebarOpen;
    chrome.storage.local.set({ sidebarOpen: newState }, () => {
      chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_SIDEBAR", sidebarOpen: newState });
    });
  });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const fetchWithHandling = (url, options) => {
    return fetch(url, options)
      .then(response => {
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        return response.text();
      });
  };

  if (msg.type === "FETCH_PREVIEW" || msg.type === "FETCH_VIDEO_INFO") {
    const videoNumber = msg.videoNumber;
    const url = `https://fc2ppvdb.com/articles/${videoNumber}`;
    fetchWithHandling(url, { credentials: "omit", mode: "cors", cache: "reload" })
      .then(htmlText => sendResponse({ success: true, html: htmlText }))
      .catch(error => {
        console.error(`Background fetch error (${msg.type}):`, error);
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }

  if (msg.type === "FETCH_PREVIEW_OFFICIAL") {
    const videoNumber = msg.videoNumber;
    chrome.cookies.set({
      url: "https://adult.contents.fc2.com",
      name: "_ac",
      value: "1",
      path: "/"
    }, () => {
      if (chrome.runtime.lastError) {
        console.error("Cookie set error:", chrome.runtime.lastError.message);
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
        return;
      }
      const url = `https://adult.contents.fc2.com/article/${videoNumber}/`;
      fetchWithHandling(url, { credentials: "include", mode: "cors", cache: "reload" })
        .then(htmlText => sendResponse({ success: true, html: htmlText }))
        .catch(error => {
          console.error("Background fetch error (FETCH_PREVIEW_OFFICIAL):", error);
          sendResponse({ success: false, error: error.message });
        });
    });
    return true;
  }

  if (msg.type === "FETCH_RELATED_VIDEOS") {
    const actressUrl = msg.actressUrl;
    fetchWithHandling(actressUrl, { credentials: "omit", mode: "cors", cache: "reload" })
      .then(htmlText => sendResponse({ success: true, html: htmlText }))
      .catch(error => {
        console.error("Background fetch error (FETCH_RELATED_VIDEOS):", error);
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }
});
