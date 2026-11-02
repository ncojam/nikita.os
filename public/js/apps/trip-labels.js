/* ================= подписи карты поездки =================
 * В тайлах OpenFreeMap есть только японское имя и латиница: русских нет (сборка без name:ru, а в OSM
 * у мелких мест Японии их почти и не бывает). Поэтому русский — из словаря ниже, для остальных латиница;
 * вторая строка всегда японская. Новое название: добавь строку «как в OSM → по-русски».
 */
const RU = {
  Kyoto: "Киото", "Kyōto": "Киото", Osaka: "Осака", "Ōsaka": "Осака", Kobe: "Кобе", "Kōbe": "Кобе", Nara: "Нара",
  Nishinomiya: "Нисиномия", Amagasaki: "Амагасаки", Ashiya: "Асия", Takarazuka: "Такарадзука", Itami: "Итами", Toyonaka: "Тоёнака",
  Suita: "Суита", Ibaraki: "Ибараки", Takatsuki: "Такацуки", Uji: "Удзи", Otsu: "Оцу", "Ōtsu": "Оцу",
  Sakyo: "Сакё", "Sakyō": "Сакё", "Sakyo Ward": "район Сакё", "Sakyō-ku": "район Сакё", Higashiyama: "Хигасияма",
  "Higashiyama Ward": "район Хигасияма", "Nakagyo Ward": "район Накагё", "Shimogyo Ward": "район Симогё", Gion: "Гион", Okazaki: "Окадзаки",
  "Kyoto Station": "станция Киото", "Higashiyama Station": "станция Хигасияма", "Sanjo Station": "станция Сандзё", "Karasuma Station": "станция Карасума",
  "Juso Station": "станция Дзюсо", "Nishinomiya-Kitaguchi": "Нисиномия-Китагути", "Nishinomiya-Kitaguchi Station": "станция Нисиномия-Китагути",
  "Koyoen Station": "станция Коёэн", "Kurakuenguchi Station": "станция Куракуэнгути", "Shukugawa Station": "станция Сюкугава",
  "Koroen Station": "станция Корокуэн", "Mount Kabuto": "гора Кабутояма", Kabutoyama: "Кабутояма", "Mount Rokko": "гора Рокко", "Rokkō Mountains": "горы Рокко",
  "Muko River": "река Муко", "Shukugawa River": "река Сюкугава", "Kamo River": "река Камо", "Osaka Bay": "Осакский залив", "Lake Biwa": "озеро Бива",
  Hyogo: "Хёго", "Hyōgo": "Хёго", "Kyoto Prefecture": "префектура Киото", "Osaka Prefecture": "префектура Осака", Japan: "Япония",
};

const LATIN = ["coalesce", ["get", "name:latin"], ["get", "name_en"], ""];
const pairs = Object.entries(RU).flat();
const TOP = ["match", LATIN, ...pairs, LATIN];
const LOCAL = ["coalesce", ["get", "name:nonlatin"], ["get", "name"]];

// первая строка — русский или латиница, вторая — японский; одна строка, если их не две
export const labelExpression = ["case",
  ["all", ["!=", LATIN, ""], ["has", "name:nonlatin"]], ["concat", TOP, "\n", ["get", "name:nonlatin"]],
  ["!=", LATIN, ""], TOP,
  LOCAL];

// станции, храмы, парки: в тёмном стиле их нет, а для поездки это главные ориентиры
export const poiLayers = text => [{
  id: "trp-poi", type: "symbol", source: "openmaptiles", "source-layer": "poi", minzoom: 12.5,
  filter: ["match", ["get", "class"], ["railway", "place_of_worship", "park", "garden", "campsite", "attraction", "museum", "library", "school"], true, false],
  layout: { "text-field": text, "text-font": ["Noto Sans Regular"], "text-size": 11, "text-anchor": "top", "text-max-width": 9, "text-padding": 4 },
  paint: { "text-color": "#c9c9d6", "text-halo-color": "rgba(10,10,14,0.85)", "text-halo-width": 1.2 },
}, {
  id: "trp-mountain", type: "symbol", source: "openmaptiles", "source-layer": "mountain_peak", minzoom: 11,
  layout: { "text-field": text, "text-font": ["Noto Sans Regular"], "text-size": 11, "text-max-width": 9 },
  paint: { "text-color": "#a8d8b0", "text-halo-color": "rgba(10,10,14,0.85)", "text-halo-width": 1.2 },
}];
