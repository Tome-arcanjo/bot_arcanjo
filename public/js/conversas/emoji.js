// Emojis do painel (sem biblioteca externa). Cada grupo é uma string; o
// composer separa por grafema (Intl.Segmenter), então emojis compostos
// (❤️, ⚖️, 👍🏽) funcionam.
export const EMOJI_GROUPS = [
  ["Mais usados", "👍🙏😊😀😉🙂👋👏💪🤝✅❤️📌📎📄📅⏰📞"],
  ["Rostos", "😀😃😄😁😆😅😂🤣😊😇🙂🙃😉😌😍🥰😘😗😙😚😋😛😝😜🤪🤨🧐🤓😎🤩🥳😏😒😞😔😟😕🙁😣😖😫😩🥺😢😭😤😠😡🤯😳🥵🥶😱😨😰😥😓🤗🤔🤭🤫🤥😶😐😑😬🙄😯😦😧😮😲🥱😴🤤😪😵🤐🥴🤢🤮🤧😷🤒🤕"],
  ["Gestos", "👋🤚🖐️✋🖖👌🤏✌️🤞🤟🤘🤙👈👉👆👇☝️👍👎✊👊🤛🤜👏🙌👐🤲🤝🙏💪"],
  ["Trabalho e jurídico", "⚖️📄📃📑📋📁📂🗂️📎🖇️📌📍✏️🖊️📝💼🏛️📅📆🗓️⏰⌛⏳📞📱💻🖨️📧📨📩📤📥🔒🔓🔑💰💵💳🧾🏦"],
  ["Símbolos", "❤️🧡💛💚💙💜🖤🤍💔❗❓⚠️🚫✅☑️✔️❌➕➖➡️⬅️⬆️⬇️🔴🟠🟡🟢🔵🟣⭐🌟✨🔥🎉🎊"],
];

const segmenter = new Intl.Segmenter("pt-BR", { granularity: "grapheme" });
export const splitEmojis = (text) => [...segmenter.segment(text)].map((s) => s.segment);
