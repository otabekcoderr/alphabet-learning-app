"TypeScript strict (any ishlatma), API kalitlar faqat .env da tursin, UI faqat o‘zbekcha bo‘lsin, o‘zgarishdan keyin npm test va npm run typecheck o‘tsin."
Git va Deploy qoidalari:

- Har bir bosqich yakunida `npm test`, `npm run typecheck` va `npm run build` xatosiz o‘tganini tasdiqlagach, `git status` da `.env` yoki maxfiy kalitlar yo‘qligini tekshir va o‘zgarishlarni alohida `git commit` qil.
- `git push` ni esa faqat men tasdiqlaganimdan keyin (yoki barcha bosqichlar tekshirilib tayyor bo‘lgach) bajar, toki jonli saytga chala versiya chiqib qolmasin.
