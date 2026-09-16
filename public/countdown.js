(function () {
  var el = document.getElementById("countdown");
  if (!el) return;
  var target = new Date(el.dataset.launch).getTime();
  var out = el.querySelector(".cd-value");
  function tick() {
    var d = target - Date.now();
    if (d <= 0) { out.textContent = "Out now"; return; }
    var days = Math.floor(d / 86400000);
    var h = Math.floor(d / 3600000) % 24;
    var m = Math.floor(d / 60000) % 60;
    var s = Math.floor(d / 1000) % 60;
    out.textContent = days + "d " + h + "h " + m + "m " + s + "s";
  }
  tick();
  setInterval(tick, 1000);
})();
