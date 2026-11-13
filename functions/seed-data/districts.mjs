// All 64 districts with their division, in the order used by the checkout
// delivery selector.

const district = (id, name_bn, name_en, division_bn, division_en) => ({
  id,
  name_bn,
  name_en,
  division_bn,
  division_en,
});

const rows = [
  // Dhaka division — 13
  ["dhaka", "ঢাকা", "Dhaka", "ঢাকা", "Dhaka"],
  ["gazipur", "গাজীপুর", "Gazipur", "ঢাকা", "Dhaka"],
  ["narayanganj", "নারায়ণগঞ্জ", "Narayanganj", "ঢাকা", "Dhaka"],
  ["narsingdi", "নরসিংদী", "Narsingdi", "ঢাকা", "Dhaka"],
  ["manikganj", "মানিকগঞ্জ", "Manikganj", "ঢাকা", "Dhaka"],
  ["munshiganj", "মুন্সিগঞ্জ", "Munshiganj", "ঢাকা", "Dhaka"],
  ["tangail", "টাঙ্গাইল", "Tangail", "ঢাকা", "Dhaka"],
  ["kishoreganj", "কিশোরগঞ্জ", "Kishoreganj", "ঢাকা", "Dhaka"],
  ["faridpur", "ফরিদপুর", "Faridpur", "ঢাকা", "Dhaka"],
  ["gopalganj", "গোপালগঞ্জ", "Gopalganj", "ঢাকা", "Dhaka"],
  ["madaripur", "মাদারীপুর", "Madaripur", "ঢাকা", "Dhaka"],
  ["shariatpur", "শরীয়তপুর", "Shariatpur", "ঢাকা", "Dhaka"],
  ["rajbari", "রাজবাড়ী", "Rajbari", "ঢাকা", "Dhaka"],

  // Chattogram division — 11
  ["chattogram", "চট্টগ্রাম", "Chattogram", "চট্টগ্রাম", "Chattogram"],
  ["coxs-bazar", "কক্সবাজার", "Cox's Bazar", "চট্টগ্রাম", "Chattogram"],
  ["cumilla", "কুমিল্লা", "Cumilla", "চট্টগ্রাম", "Chattogram"],
  ["brahmanbaria", "ব্রাহ্মণবাড়িয়া", "Brahmanbaria", "চট্টগ্রাম", "Chattogram"],
  ["chandpur", "চাঁদপুর", "Chandpur", "চট্টগ্রাম", "Chattogram"],
  ["feni", "ফেনী", "Feni", "চট্টগ্রাম", "Chattogram"],
  ["noakhali", "নোয়াখালী", "Noakhali", "চট্টগ্রাম", "Chattogram"],
  ["lakshmipur", "লক্ষ্মীপুর", "Lakshmipur", "চট্টগ্রাম", "Chattogram"],
  ["khagrachhari", "খাগড়াছড়ি", "Khagrachhari", "চট্টগ্রাম", "Chattogram"],
  ["rangamati", "রাঙ্গামাটি", "Rangamati", "চট্টগ্রাম", "Chattogram"],
  ["bandarban", "বান্দরবান", "Bandarban", "চট্টগ্রাম", "Chattogram"],

  // Rajshahi division — 8
  ["rajshahi", "রাজশাহী", "Rajshahi", "রাজশাহী", "Rajshahi"],
  ["bogura", "বগুড়া", "Bogura", "রাজশাহী", "Rajshahi"],
  ["pabna", "পাবনা", "Pabna", "রাজশাহী", "Rajshahi"],
  ["sirajganj", "সিরাজগঞ্জ", "Sirajganj", "রাজশাহী", "Rajshahi"],
  ["natore", "নাটোর", "Natore", "রাজশাহী", "Rajshahi"],
  ["naogaon", "নওগাঁ", "Naogaon", "রাজশাহী", "Rajshahi"],
  ["chapainawabganj", "চাঁপাইনবাবগঞ্জ", "Chapainawabganj", "রাজশাহী", "Rajshahi"],
  ["joypurhat", "জয়পুরহাট", "Joypurhat", "রাজশাহী", "Rajshahi"],

  // Khulna division — 10
  ["khulna", "খুলনা", "Khulna", "খুলনা", "Khulna"],
  ["jashore", "যশোর", "Jashore", "খুলনা", "Khulna"],
  ["jhenaidah", "ঝিনাইদহ", "Jhenaidah", "খুলনা", "Khulna"],
  ["magura", "মাগুরা", "Magura", "খুলনা", "Khulna"],
  ["narail", "নড়াইল", "Narail", "খুলনা", "Khulna"],
  ["kushtia", "কুষ্টিয়া", "Kushtia", "খুলনা", "Khulna"],
  ["chuadanga", "চুয়াডাঙ্গা", "Chuadanga", "খুলনা", "Khulna"],
  ["meherpur", "মেহেরপুর", "Meherpur", "খুলনা", "Khulna"],
  ["satkhira", "সাতক্ষীরা", "Satkhira", "খুলনা", "Khulna"],
  ["bagerhat", "বাগেরহাট", "Bagerhat", "খুলনা", "Khulna"],

  // Barishal division — 6
  ["barishal", "বরিশাল", "Barishal", "বরিশাল", "Barishal"],
  ["patuakhali", "পটুয়াখালী", "Patuakhali", "বরিশাল", "Barishal"],
  ["bhola", "ভোলা", "Bhola", "বরিশাল", "Barishal"],
  ["pirojpur", "পিরোজপুর", "Pirojpur", "বরিশাল", "Barishal"],
  ["barguna", "বরগুনা", "Barguna", "বরিশাল", "Barishal"],
  ["jhalokathi", "ঝালকাঠি", "Jhalokathi", "বরিশাল", "Barishal"],

  // Sylhet division — 4
  ["sylhet", "সিলেট", "Sylhet", "সিলেট", "Sylhet"],
  ["moulvibazar", "মৌলভীবাজার", "Moulvibazar", "সিলেট", "Sylhet"],
  ["habiganj", "হবিগঞ্জ", "Habiganj", "সিলেট", "Sylhet"],
  ["sunamganj", "সুনামগঞ্জ", "Sunamganj", "সিলেট", "Sylhet"],

  // Rangpur division — 8
  ["rangpur", "রংপুর", "Rangpur", "রংপুর", "Rangpur"],
  ["dinajpur", "দিনাজপুর", "Dinajpur", "রংপুর", "Rangpur"],
  ["nilphamari", "নীলফামারী", "Nilphamari", "রংপুর", "Rangpur"],
  ["lalmonirhat", "লালমনিরহাট", "Lalmonirhat", "রংপুর", "Rangpur"],
  ["kurigram", "কুড়িগ্রাম", "Kurigram", "রংপুর", "Rangpur"],
  ["thakurgaon", "ঠাকুরগাঁও", "Thakurgaon", "রংপুর", "Rangpur"],
  ["panchagarh", "পঞ্চগড়", "Panchagarh", "রংপুর", "Rangpur"],
  ["gaibandha", "গাইবান্ধা", "Gaibandha", "রংপুর", "Rangpur"],

  // Mymensingh division — 4
  ["mymensingh", "ময়মনসিংহ", "Mymensingh", "ময়মনসিংহ", "Mymensingh"],
  ["jamalpur", "জামালপুর", "Jamalpur", "ময়মনসিংহ", "Mymensingh"],
  ["sherpur", "শেরপুর", "Sherpur", "ময়মনসিংহ", "Mymensingh"],
  ["netrokona", "নেত্রকোণা", "Netrokona", "ময়মনসিংহ", "Mymensingh"],
];

export const DISTRICTS = rows.map(([id, name_bn, name_en, division_bn, division_en], position) =>
  ({ ...district(id, name_bn, name_en, division_bn, division_en), position }));

export const DIVISIONS = [...new Set(DISTRICTS.map((row) => `${row.division_bn}|${row.division_en}`))]
  .map((pair) => {
    const [name_bn, name_en] = pair.split("|");
    return { name_bn, name_en };
  });
