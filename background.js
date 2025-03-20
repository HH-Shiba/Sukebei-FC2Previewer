chrome.action.onClicked.addListener((tab) => {
  chrome.storage.local.get("sidebarOpen", (result) => {
    let newState = !result.sidebarOpen;
    chrome.storage.local.set({ sidebarOpen: newState }, () => {
      chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_SIDEBAR", sidebarOpen: newState });
    });
  });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "FETCH_PREVIEW") {
    const videoNumber = msg.videoNumber;
    const url = `https://fc2ppvdb.com/articles/${videoNumber}`;
    fetch(url, {
      credentials: "omit",
      mode: "cors",
      cache: "reload"
    })
    .then(response => {
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      return response.text();
    })
    .then(htmlText => {
      sendResponse({ success: true, html: htmlText });
    })
    .catch(error => {
      console.error("Background fetch error (FETCH_PREVIEW):", error);
      sendResponse({ success: false, error: error.message });
    });
    return true;
  } else if (msg.type === "FETCH_VIDEO_INFO") {
    const videoNumber = msg.videoNumber;
    const url = `https://fc2ppvdb.com/articles/${videoNumber}`;
    fetch(url, {
      credentials: "omit",
      mode: "cors",
      cache: "reload"
    })
    .then(response => {
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      return response.text();
    })
    .then(htmlText => {
      sendResponse({ success: true, html: htmlText });
    })
    .catch(error => {
      console.error("Background fetch error (FETCH_VIDEO_INFO):", error);
      sendResponse({ success: false, error: error.message });
    });
    return true;
  } else if (msg.type === "FETCH_PREVIEW_OFFICIAL") {
    const videoNumber = msg.videoNumber;
    chrome.cookies.set({
      url: "https://adult.contents.fc2.com",
      name: "_ac",
      value: "1",
      path: "/"
    }, (cookie) => {
      if (chrome.runtime.lastError) {
        console.error("Cookie set error:", chrome.runtime.lastError.message);
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
        return;
      }
      const url = `https://adult.contents.fc2.com/article/${videoNumber}/`;
      fetch(url, {
        credentials: "include",
        mode: "cors",
        cache: "reload"
      })
      .then(response => {
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        return response.text();
      })
      .then(htmlText => {
        sendResponse({ success: true, html: htmlText });
      })
      .catch(error => {
        console.error("Background fetch error (FETCH_PREVIEW_OFFICIAL):", error);
        sendResponse({ success: false, error: error.message });
      });
    });
    return true;
  } else if (msg.type === "FETCH_RELATED_VIDEOS") {
    const actressUrl = msg.actressUrl; // 完整女優頁面 URL
    fetch(actressUrl, {
      credentials: "omit",
      mode: "cors",
      cache: "reload"
    })
    .then(response => {
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      return response.text();
    })
    .then(htmlText => {
      sendResponse({ success: true, html: htmlText });
    })
    .catch(error => {
      console.error("Background fetch error (FETCH_RELATED_VIDEOS):", error);
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }
});
