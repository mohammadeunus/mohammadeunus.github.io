(function () {
  var btn = document.getElementById('toTop');
  var label = document.getElementById('toTopLabel');
  if (!btn) return;

  btn.style.display = 'none';
  if (label) label.style.display = 'none';

  // Compute total reading time from article text
  var article = document.querySelector('article') ||
                document.querySelector('.content') ||
                document.body;
  var words = (article.innerText || article.textContent || '').trim().split(/\s+/).length;
  var totalMinutes = Math.max(1, Math.round(words / 200));

  function update() {
    var scrolled = window.scrollY || document.documentElement.scrollTop;
    var total = document.documentElement.scrollHeight - window.innerHeight;

    if (scrolled > 100 && total > 0) {
      btn.style.display = 'inline-flex';
      if (label) {
        var progress = Math.min(scrolled / total, 1);
        var remaining = Math.round(totalMinutes * (1 - progress));
        label.textContent = remaining <= 0 ? '< 1 min left' : remaining + ' min left';
        label.style.display = 'inline-block';
      }
    } else {
      btn.style.display = 'none';
      if (label) label.style.display = 'none';
    }
  }

  window.addEventListener('scroll', update, { passive: true });
  update();
})();
