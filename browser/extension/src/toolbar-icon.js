// The toolbar button's icon is a white or a black outline (ui/icons/png).
// The manifest default is black, for Chromium's light toolbar; NODE pages
// switch it to match the system's light or dark appearance.
(function () {
  const dark = matchMedia("(prefers-color-scheme: dark)");
  const paint = () => {
    const v = dark.matches ? "on-dark" : "on-light";
    chrome.action?.setIcon({ path: { 16: `ui/icons/png/suggest-${v}-16.png`, 32: `ui/icons/png/suggest-${v}-32.png` } }).catch(() => {});
  };
  paint();
  dark.addEventListener("change", paint);
})();
