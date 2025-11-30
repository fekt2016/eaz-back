/**
 * Distance Results Summary
 * Clean summary of successful distance calculations
 */

const results = {
  A: [
    { town: "Mamobi, Accra, Ghana", distance: 5.28 },
    { town: "Kokomlemle, Accra, Ghana", distance: 6.35 },
    { town: "Adabraka, Accra, Ghana", distance: 7.07 },
    { town: "Achimota, Accra, Ghana", distance: 9.34 },
    { town: "Kaneshie, Accra, Ghana", distance: 10.28 },
    { town: "Dansoman, Accra, Ghana", distance: 11.92 },
    { town: "Odorkor, Accra, Ghana", distance: 12.42 },
  ],
  B: [
    { town: "Achimota, Accra, Ghana", distance: 9.34 },
    { town: "Kaneshie, Accra, Ghana", distance: 10.28 },
    { town: "Dansoman, Accra, Ghana", distance: 11.92 },
    { town: "Odorkor, Accra, Ghana", distance: 12.42 },
    { town: "Haatso, Accra, Ghana", distance: 13.84 },
    { town: "Awoshie, Accra, Ghana", distance: 16.70 },
    { town: "Kwabenya, Accra, Ghana", distance: 18.30 },
    { town: "Adenta, Accra, Ghana", distance: 18.66 },
    { town: "Weija, Accra, Ghana", distance: 21.91 },
    { town: "Amasaman, Accra, Ghana", distance: 22.26 },
    { town: "Pokuase, Accra, Ghana", distance: 23.95 },
    { town: "Kasoa, Central Region, Ghana", distance: 32.00 },
  ],
  C: [
    { town: "Haatso, Accra, Ghana", distance: 13.84 },
    { town: "Batsonaa, Tema, Ghana", distance: 15.50 },
    { town: "Kwabenya, Accra, Ghana", distance: 18.30 },
    { town: "Adenta, Accra, Ghana", distance: 18.66 },
    { town: "Ashaiman, Tema, Ghana", distance: 23.30 },
    { town: "Sakumono, Tema, Ghana", distance: 23.86 },
    { town: "Lashibi, Tema, Ghana", distance: 25.02 },
  ],
  D: [
    { town: "Teshie, Accra, Ghana", distance: 10.44 },
    { town: "Batsonaa, Tema, Ghana", distance: 15.50 },
    { town: "Nungua, Accra, Ghana", distance: 22.22 },
    { town: "Sakumono, Tema, Ghana", distance: 23.86 },
    { town: "Lashibi, Tema, Ghana", distance: 25.02 },
    { town: "Dawhenya, Tema, Ghana", distance: 34.89 },
    { town: "Prampram, Tema, Ghana", distance: 45.13 },
  ],
  E: [
    { town: "Adenta, Accra, Ghana", distance: 18.66 },
    { town: "Oyibi, Accra, Ghana", distance: 28.93 },
    { town: "Aburi, Eastern Region, Ghana", distance: 34.04 },
    { town: "Nsawam, Eastern Region, Ghana", distance: 36.61 },
    { town: "Dodowa Road, Accra, Ghana", distance: 36.90 },
    { town: "Suhum, Eastern Region, Ghana", distance: 66.13 },
    { town: "Apedwa, Eastern Region, Ghana", distance: 76.09 },
    { town: "Asamankese, Eastern Region, Ghana", distance: 77.07 },
    { town: "Koforidua, Eastern Region, Ghana", distance: 79.91 },
    { town: "Akosombo, Eastern Region, Ghana", distance: 96.60 },
    { town: "Nkawkaw, Eastern Region, Ghana", distance: 143.18 },
  ],
  F: [
    { town: "Oyibi, Accra, Ghana", distance: 28.93 },
    { town: "Aburi, Eastern Region, Ghana", distance: 34.04 },
    { town: "Nsawam, Eastern Region, Ghana", distance: 36.61 },
    { town: "Dodowa Road, Accra, Ghana", distance: 36.90 },
    { town: "Suhum, Eastern Region, Ghana", distance: 66.13 },
    { town: "Apedwa, Eastern Region, Ghana", distance: 76.09 },
    { town: "Asamankese, Eastern Region, Ghana", distance: 77.07 },
    { town: "Koforidua, Eastern Region, Ghana", distance: 79.91 },
    { town: "Akosombo, Eastern Region, Ghana", distance: 96.60 },
    { town: "Nkawkaw, Eastern Region, Ghana", distance: 143.18 },
    { town: "Takoradi, Western Region, Ghana", distance: 227.00 },
    { town: "Kumasi, Ashanti Region, Ghana", distance: 250.94 },
    { town: "Sunyani, Bono Region, Ghana", distance: 371.93 },
    { town: "Tamale, Northern Region, Ghana", distance: 623.68 },
    { town: "Bolgatanga, Upper East Region, Ghana", distance: 769.19 },
  ],
};

console.log("=".repeat(80));
console.log("DISTANCE ANALYSIS SUMMARY - Towns with Valid Distances");
console.log("Warehouse Location: HRH2+R22, Al-Waleed bin Talal Highway, Accra");
console.log("Coordinates: 5.582930, -0.171870");
console.log("=".repeat(80));

Object.keys(results).forEach((zone) => {
  console.log(`\n📍 ZONE ${zone}`);
  console.log("-".repeat(80));
  results[zone].forEach((item, index) => {
    console.log(`${(index + 1).toString().padStart(3)}. ${item.town.padEnd(50)} ${item.distance.toFixed(2).padStart(8)} km`);
  });
  const avg = results[zone].reduce((sum, item) => sum + item.distance, 0) / results[zone].length;
  console.log(`\n   Closest: ${results[zone][0].town} (${results[zone][0].distance.toFixed(2)} km)`);
  console.log(`   Farthest: ${results[zone][results[zone].length - 1].town} (${results[zone][results[zone].length - 1].distance.toFixed(2)} km)`);
  console.log(`   Average: ${avg.toFixed(2)} km`);
});

console.log("\n" + "=".repeat(80));
console.log("Note: Some towns returned errors (NOT_FOUND) from Google Maps API.");
console.log("These may need more specific address formats or verification.");
console.log("=".repeat(80));

