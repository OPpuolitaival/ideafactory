import type { TranslationKey } from './en.js';

const fi: Record<TranslationKey, string> = {
  // Topbar
  'topbar.title': 'Idea Factory',
  'topbar.version': 'v2',
  'topbar.sessions': 'Istunnot',
  'topbar.settings': 'Asetukset',

  // Language
  'language.en': 'English',
  'language.fi': 'Suomi',
  'language.label': 'Kieli',

  // Dashboard
  'dashboard.startTitle': 'Aloita uusi istunto',
  'dashboard.startDescription':
    'Syötä tutkittava aihealue. Voit olla niin tarkka tai laaja kuin haluat.',
  'dashboard.placeholder': 'esim. "Tuolien tulevaisuus", "Kestävä pakkaus"',
  'dashboard.generate': 'Luo',
  'dashboard.starting': 'Käynnistetään...',
  'dashboard.models': 'Mallit',
  'dashboard.pastSessions': 'Aiemmat istunnot',
  'dashboard.noSessions': 'Ei vielä istuntoja. Aloita uusi yllä.',
  'dashboard.completed': 'Valmis',
  'dashboard.inProgress': 'Käynnissä',
  'dashboard.duplicate': 'Kopioi',
  'dashboard.delete': 'Poista',
  'dashboard.mixed': 'Sekoitus',

  // Stage labels
  'stage.taxonomy': 'Taksonomia',
  'stage.methods': 'Menetelmät',
  'stage.rubric': 'Arviointikriteerit',
  'stage.factory': 'Tehdas',

  // Taxonomy Stage
  'taxonomy.title': 'Vaihe 1: Taksonomia',
  'taxonomy.loading': 'Kartoitetaan ongelma-avaruutta...',
  'taxonomy.description': 'Selaa ongelma-avaruutta ja valitse tutkittava koordinaatti.',
  'taxonomy.selected': 'Valittu',
  'taxonomy.filterPlaceholder': 'Suodata taksonomiaa...',
  'taxonomy.expanding': 'Laajennetaan taksonomian haaroja...',
  'taxonomy.lockContinue': 'Lukitse ja jatka',
  'taxonomy.advancing': 'Edetään...',

  // Methods Stage
  'methods.title': 'Vaihe 2: Menetelmät',
  'methods.loading': 'Analysoidaan koordinaattia menetelmäsuosituksia varten...',
  'methods.description':
    'Valitse 3–5 ajattelumenetelmää. Suositukset on korostettu.',
  'methods.selectedCount': '{count} / 3–5 menetelmää valittu',
  'methods.recommended': 'Suositeltu',
  'methods.custom': 'Mukautettu',
  'methods.goodFor': 'Sopii',
  'methods.nextRubric': 'Seuraava: Arviointikriteerit',
  'methods.advancing': 'Edetään...',

  // Rubric Stage
  'rubric.title': 'Vaihe 3: Arviointikriteerit',
  'rubric.loading': 'Suunnitellaan arviointikriteereitä...',
  'rubric.description':
    'Tarkista ja muokkaa arviointikehystä. Tämä määrittelee "hyvän" ennen ideoiden tuottamista.',
  'rubric.hardGates': 'Ehdottomat portit (Läpi/Hylätty)',
  'rubric.addGate': '+ Lisää portti',
  'rubric.scoredCriteria': 'Pisteytetyt kriteerit (1–5)',
  'rubric.criterionPlaceholder': 'Kriteerin nimi',
  'rubric.descriptionPlaceholder': 'Kuvaus (1=huono, 5=hyvä)',
  'rubric.weight': 'Painoarvo',
  'rubric.addCriterion': '+ Lisää kriteeri',
  'rubric.nextFactory': 'Seuraava: Käynnistä tehdas',
  'rubric.startingFactory': 'Käynnistetään tehdasta...',

  // Factory Stage
  'factory.title': 'Vaihe 4: Tehdas',
  'factory.elapsed': 'kulunut',
  'factory.phaseIdle': 'Odotetaan...',
  'factory.phaseDiverge': 'Hajauttaminen — Ideoiden tuottaminen',
  'factory.phaseConverge': 'Yhdistäminen — Suodatus ja pisteytys',
  'factory.phaseEvolve': 'Kehittäminen — Konseptien jalostus',
  'factory.phaseInteractive': 'Arviointi — Laadunvarmistus ja paketointi',
  'factory.phaseComplete': 'Istunto valmis',
  'factory.waitingWorkers': 'Odotetaan työntekijöiden aloittavan ideoiden tuottamista...',
  'factory.ideas': 'ideaa',
  'factory.eliminated': 'Poistettu',
  'factory.eliminatedDuring': 'Poistettu yhdistämisvaiheessa',
  'factory.evolved':
    'Konsepteja on kehitetty — heikkoudet korjattu, vahvuuksia vahvistettu.',
  'factory.criticalReviews': 'Kriittiset arvioinnit',
  'factory.feasibility': 'Toteutettavuus',
  'factory.ideaPool': 'Ideapooli',
  'factory.ideaPoolDesc':
    'Valitse ideoita ja suorita kriittinen arviointi toteutettavuuden analysoimiseksi ja raporttien tuottamiseksi.',
  'factory.runReview': 'Suorita kriittinen arviointi',
  'factory.reviewing': 'Arvioidaan...',
  'factory.reviewed': 'Arvioitu',
  'factory.packaged': 'Paketoitu',
  'factory.downloadHtml': 'Lataa HTML',
  'factory.copyPrompt': 'Kopioi kehote',
  'factory.eliminatedIdeas': 'Poistetut ideat',
  'factory.completeSession': 'Viimeistele istunto',
  'factory.completing': 'Viimeistellään...',
  'factory.interrupted': 'Tehdas keskeytynyt',
  'factory.foundWorkers':
    'Löydettiin {workerCount} valmista työntekijää ja {ideaCount} ideaa.',
  'factory.resumePreserve': 'Jatka (säilytä edistyminen)',
  'factory.resuming': 'Jatketaan...',
  'factory.retryFresh': 'Yritä uudelleen (aloita alusta)',
  'factory.retrying': 'Yritetään uudelleen...',
  'factory.collapse': 'Pienennä',
  'factory.expand': 'Laajenna',

  // Settings Dialog
  'settings.title': 'Asetukset',
  'settings.authInfo':
    'Tunnistautuminen tapahtuu automaattisesti Claude Coden tai ANTHROPIC_API_KEY-ympäristömuuttujan kautta.',
  'settings.sessionModels': 'Istunnon mallit',
  'settings.currentDefaults': 'Nykyiset oletusarvot',
  'settings.ideasPerWorker': 'Ideoita/työntekijä',
  'settings.webSearch': 'Verkkohaku',
  'settings.on': 'päällä',
  'settings.off': 'pois',
  'settings.defaultModel': 'Oletusmalli',
  'settings.editConfig':
    'Muokkaa tiedostoa ~/.ideafactory/config.yaml muuttaaksesi oletusarvoja.',

  // Error Banner
  'error.resuming': 'Jatketaan...',
  'error.resumePreserve': 'Jatka (säilytä {count} ideaa)',
  'error.retrying': 'Yritetään uudelleen...',
  'error.retry': 'Yritä uudelleen',
  'error.retryFresh': 'Yritä uudelleen (aloita alusta)',
  'error.dismiss': 'Hylkää',

  // Rollback Modal
  'rollback.goBackTo': 'Palaa vaiheeseen {stage}?',
  'rollback.progressDiscarded': 'Vaiheen {stage} jälkeinen edistyminen poistetaan:',
  'rollback.editSession': 'Muokkaa tätä istuntoa',
  'rollback.editSessionDesc':
    'Palaa taaksepäin ja poista vaiheen {stage} jälkeinen edistyminen.',
  'rollback.makeCopy': 'Tee ensin kopio',
  'rollback.makeCopyDesc':
    'Kopioi istunto ja muokkaa kopiota. Alkuperäinen säilyy.',
  'rollback.cancel': 'Peruuta',

  // Thought Feed
  'thoughtFeed.title': 'Agenttien ajatukset',
  'thoughtFeed.empty': 'Agenttien ajatukset näkyvät täällä...',
  'thoughtFeed.connecting': 'Yhdistetään...',
  'thoughtFeed.reconnecting': 'Yhdistetään uudelleen...',
  'thoughtFeed.disconnected': 'Yhteys katkaistu',

  // App
  'app.viewing': 'Katselet',
  'app.stageReadOnly': 'vaihetta (vain luku)',
  'app.backToCurrent': 'Takaisin nykyiseen',
  'app.editFromHere': 'Muokkaa tästä...',
};

export default fi;
