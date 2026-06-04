# Kirjoita ✍️

**Harjoittele suomen kielen esseekirjoittamista** — Duolingo-tyylinen web-sovellus lukiolaisille.

Tekoälypohjainen palaute, edistymisen seuranta, putkiseuranta ja tasojärjestelmä. Täysin ilmainen.

---

## 🚀 Ota käyttöön GitHub Pagesilla (5 min)

### 1. Forkkaa tai kloonaa repo

```bash
git clone https://github.com/SINUN-KÄYTTÄJÄNIMI/kirjoita.git
cd kirjoita
```

### 2. Luo GitHub-repo ja pushaa

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/SINUN-KÄYTTÄJÄNIMI/kirjoita.git
git push -u origin main
```

### 3. Ota GitHub Pages käyttöön

1. Avaa repo GitHubissa → **Settings** → **Pages**
2. Kohdassa **Source** valitse **GitHub Actions**
3. Odota ~1 minuutti — sovellus on nyt osoitteessa:
   `https://SINUN-KÄYTTÄJÄNIMI.github.io/kirjoita`

---

## 🔑 Groq API -avain (ilmainen)

Sovellus käyttää [Groq](https://console.groq.com/keys) -tekoälyä arviointiin.

1. Mene osoitteeseen [console.groq.com/keys](https://console.groq.com/keys)
2. Luo ilmainen tili
3. Luo uusi API-avain (alkaa `gsk_...`)
4. Syötä avain sovellukseen kirjautumisen yhteydessä

Groqin ilmaistierissä on riittävästi kutsurajaa normaalikäyttöön.

---

## 🎓 Opetusmetodologia

Sovellus hyödyntää tutkittuja oppimismenetelmiä:

- **Välitön palaute** — arviointi heti kirjoittamisen jälkeen (Hattie & Timperley, 2007)
- **Esimerkkivertailu** — oman tekstin vs. esimerkkivastauksen vertailu aktivoi metakognitiota
- **Spaced repetition** — harjoitustyypit etenevät tason mukaan
- **Deliberate practice** — spesifiset kriteerit (sisältö, rakenne, sanasto, kielioppi)
- **Streakmekanismi** — päivittäinen motivaatio jatkaa harjoittelua
- **XP-järjestelmä** — näkyvä edistyminen ylläpitää motivaatiota (Self-Determination Theory)

---

## 📁 Rakenne

```
kirjoita/
├── index.html          # Koko sovellus (SPA)
├── 404.html            # GitHub Pages fallback
├── README.md
└── .github/
    └── workflows/
        └── deploy.yml  # Automaattinen deployment
```

---

## 🔒 Yksityisyys

- Kaikki käyttäjädata tallennetaan **selaimesi localStorage**-muistiin
- Mitään ei lähetetä ulkoisille palvelimille (paitsi Groq API arviointia varten)
- Ei rekisteröitymistä, ei sähköpostia, ei pilvipalvelua

---

## Lisenssi

MIT
