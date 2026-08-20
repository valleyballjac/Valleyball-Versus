export function createGameHud(document) {
  const staminaEl = document.getElementById('stamina');
  const staminaFill = document.getElementById('staminaFill');
  const staminaNum = document.getElementById('staminaNum');
  const staminaTicks = document.getElementById('staminaTicks');

  let tickSignature = '';
  
  function updateStaminaBar(player, STAM, stamina) {
    const sig = STAM.max + '|' + STAM.diveCost + '|' + STAM.slideMinReserve + '|' + STAM.hitCost;
    if (sig !== tickSignature) {
      tickSignature = sig;
      const marks = [
        ['dive', STAM.diveCost],
        ['slide', STAM.slideMinReserve],
        ['hit', STAM.hitCost],
      ];
      staminaTicks.innerHTML = '';
      for (const [name, cost] of marks) {
        if (!(STAM.max > 0) || cost <= 0 || cost >= STAM.max) continue;
        const i = document.createElement('i');
        i.style.left = ((cost / STAM.max) * 100) + '%';
        i.title = name + ': ' + cost;
        staminaTicks.appendChild(i);
      }
    }

    const f = player.staminaFraction;
    staminaFill.style.width = (f * 100).toFixed(1) + '%';
    staminaNum.textContent = player.isExhausted
      ? stamina.exhaustRemaining.toFixed(1) + 's'
      : Math.round(player.stamina);

    const cls = staminaEl.classList;
    cls.toggle('out', player.isExhausted);
    cls.toggle('spent', !player.isExhausted && player.stamina < STAM.slideMinReserve);
    cls.toggle('low', !player.isExhausted
      && player.stamina >= STAM.slideMinReserve && player.stamina < STAM.diveCost);
    cls.toggle('denied', player.staminaDenied);
    
    // We can also toggle the staminaEl visibility
    if (staminaEl.style.display === 'none') {
        staminaEl.style.display = 'block';
    }
  }

  return { updateStaminaBar };
}
