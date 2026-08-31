async (page) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.locator('#search').fill('中国电影博物馆');
  await page.waitForTimeout(250);
  const searchStatus = await page.locator('#status').textContent();
  const results = await page.locator('.record-item').count();
  await page.locator('.record-item').first().click();
  await page.waitForTimeout(250);
  const popupVisible = await page.locator('.imax-info').count();

  await page.locator('#search').fill('');
  await page.locator('[data-system="GT Laser"]').click();
  await page.waitForTimeout(250);
  const gtStatus = await page.locator('#status').textContent();

  await page.setViewportSize({ width: 375, height: 812 });
  const mobileLayout = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    panelWidth: Math.round(document.querySelector('.panel').getBoundingClientRect().width)
  }));

  return { searchStatus, results, popupVisible, gtStatus, mobileLayout };
}
