import type { ScenarioSeed } from '../model.js';

/**
 * Six seed scenarios. DRAFT: clinical and pedagogical content must be reviewed
 * by faculty before publishing. All patients are fictional.
 *
 * This file is deliberately NOT exported from the package index, so hidden
 * concerns and cue scripts never ship in the resident-facing web bundle.
 * Import it via "@plainspeak/shared/seed" (seed script and tests only).
 */
export const SEED_SCENARIOS: ScenarioSeed[] = [
  {
    id: 'htn-new-diagnosis',
    tags: ['hypertension', 'new diagnosis'],
    briefing: {
      title: 'New high blood pressure',
      difficulty: 1,
      persona: { name: 'Ray Kowalski', age: 52, pronouns: 'he/him' },
      reasonForVisit: 'Follow-up after two high blood pressure readings at earlier visits.',
      residentTask:
        'Explain that Ray has high blood pressure, why it matters even though he feels fine, and the plan: a once-daily medicine, cutting back on salt, and checking his pressure at home.',
      residentFacts: [
        'Office BP 152/96 and 148/94 at the last two visits; today 150/94.',
        'Home readings over 1 week average 146/92.',
        'Basic labs, kidney function and EKG are normal.',
        'No current medicines. Drives a propane delivery truck (needs a DOT medical card).',
      ],
      learningObjectives: [
        'Explain a silent condition in plain language without using fear as the main motivator.',
        'Follow a simple order: what it is, why it matters, what we will do, what you will do.',
        'Respond to job and family concerns instead of steamrolling them.',
        'Check understanding with teach-back.',
      ],
      estimatedMinutes: 6,
    },
    script: {
      background:
        'Married, two grown kids. Drives a propane delivery route; long days, eats gas-station food, lots of coffee. Drinks a couple beers on weekends. Does not smoke. Rarely sees doctors.',
      healthLiteracy: 'moderate',
      emotionalState:
        'Guarded and a little defensive. "I feel fine." Warms up if the resident is straightforward and respectful.',
      hiddenConcern:
        'Afraid that a diagnosis or medicine will cost him his commercial driver medical card and his job. Also, his father had a stroke at 60 and was never the same, which scares him more than he lets on.',
      openingLine: 'So the nurse says my blood pressure is up again. Honestly, I feel fine.',
      patientKnows: [
        'Has never taken blood pressure medicine.',
        'Father had a stroke at 60 and spent his last years in a nursing home.',
        'Eats a lot of fast food and salty snacks on his route.',
        'Needs to renew his DOT medical card in about 4 months.',
      ],
      speakingStyle: 'Short, plain sentences. Practical. A little gruff but polite.',
      cueScript: [
        {
          id: 'quiet-after-dense',
          cue: 'Goes quiet after a long explanation',
          trigger: { type: 'resident_turn_words_gt', value: 90 },
          maxFires: 1,
          performance: {
            say: 'Okay.',
            delivery: { volume: 'quiet', pauseBeforeMs: 2500, emotion: 'hesitant' },
            nonverbal: ['look_away'],
          },
          expectedResidentResponse:
            'Pauses and checks in, e.g. "That was a lot. What questions do you have so far?"',
        },
        {
          id: 'job-worry',
          cue: 'Worries about his commercial driver card',
          trigger: {
            type: 'topic_mentioned',
            topics: ['medicine', 'medication', 'pill', 'prescription'],
          },
          maxFires: 1,
          performance: {
            say: "Is taking pills for this going to mess up my driving card? I can't lose my job.",
            delivery: { emotion: 'worried' },
            nonverbal: ['frown'],
          },
          expectedResidentResponse:
            'Acknowledges the worry, explains that treated blood pressure usually helps keep the card, and offers to help with the paperwork.',
        },
        {
          id: 'dad-stroke',
          cue: 'Mentions his father’s stroke',
          trigger: { type: 'topic_mentioned', topics: ['stroke', 'heart attack', 'brain'] },
          maxFires: 1,
          performance: {
            say: 'My dad had a stroke. He was never the same after.',
            delivery: { volume: 'quiet', emotion: 'sad', pauseBeforeMs: 1500 },
            nonverbal: ['look_away'],
          },
          expectedResidentResponse:
            'Responds with empathy first ("I’m sorry, that sounds hard"), then gently connects treatment to lowering his own risk.',
        },
        {
          id: 'i-guess',
          cue: 'Says “I guess…” when not bought in',
          trigger: { type: 'turn_index', value: 6 },
          maxFires: 1,
          performance: {
            say: 'I guess... if you think I have to.',
            delivery: { emotion: 'hesitant', rate: 'slow' },
            nonverbal: ['avoid_eye_contact'],
          },
          expectedResidentResponse:
            'Notices the hesitation and explores it, e.g. "It sounds like you’re not sure. What’s on your mind?"',
        },
      ],
    },
  },
  {
    id: 't2dm-new-diagnosis',
    tags: ['diabetes', 'new diagnosis', 'low health literacy'],
    briefing: {
      title: 'New type 2 diabetes',
      difficulty: 2,
      persona: { name: 'Linda Shaffer', age: 47, pronouns: 'she/her' },
      reasonForVisit: 'Here to go over blood work from her yearly physical.',
      residentTask:
        'Explain that Linda has type 2 diabetes, what that means for her body, and the plan: starting metformin, small food changes, a diabetes class, and a repeat A1c in 3 months.',
      residentFacts: [
        'Hemoglobin A1c 7.4%; fasting glucose 148 mg/dL. Repeat A1c confirmed (7.3%).',
        'BMI 33. Blood pressure 128/80. Kidney function normal.',
        'No symptoms. Takes no regular medicines.',
        'Works as a school cafeteria manager.',
      ],
      learningObjectives: [
        'Adjust explanations for low health literacy: short sentences, one idea at a time.',
        'Use teach-back instead of "Does that make sense?"',
        'Respond to shame and blame without judgment.',
        'Address fear about insulin and complications.',
      ],
      estimatedMinutes: 7,
    },
    script: {
      background:
        'Divorced, lives with her teenage son. Manages the cafeteria at the elementary school. Did not finish high school; reading is hard for her and she nods along to avoid looking slow. Her mother had diabetes.',
      healthLiteracy: 'low',
      emotionalState: 'Anxious and ashamed. Blames herself. Nods and says "mm-hm" even when lost.',
      hiddenConcern:
        'Her mother had diabetes, ended up on insulin shots, lost part of her foot and was on dialysis. Linda is terrified of needles and of "ending up like Mom".',
      openingLine: 'Is it bad? The nurse said my sugar number came back high.',
      patientKnows: [
        'Mother had diabetes, used insulin, had a foot amputation and kidney dialysis.',
        'Drinks 2–3 regular sodas a day and snacks at work.',
        'Is scared of needles.',
        'Has never heard the word "A1c".',
      ],
      speakingStyle: 'Simple words. Says "mm-hm" and "okay" a lot. Apologizes often.',
      cueScript: [
        {
          id: 'nod-along',
          cue: 'Nods along after a dense explanation (may not understand)',
          trigger: { type: 'resident_turn_words_gt', value: 80 },
          maxFires: 2,
          performance: {
            say: 'Mm-hm. Okay.',
            delivery: { volume: 'quiet', pauseBeforeMs: 1500, emotion: 'confused' },
            nonverbal: ['nod'],
          },
          expectedResidentResponse:
            'Does not take the nod as understanding; uses teach-back, e.g. "Can you tell me in your own words what diabetes means for you?"',
        },
        {
          id: 'repeat-question',
          cue: 'Repeats a basic question',
          trigger: { type: 'no_understanding_check_for_turns', value: 3 },
          maxFires: 1,
          performance: {
            say: 'Sorry. So... is it diabetes, or is it just high sugar?',
            delivery: { emotion: 'confused' },
            nonverbal: ['frown'],
          },
          expectedResidentResponse:
            'Answers simply and kindly without making her feel slow, then checks understanding.',
        },
        {
          id: 'self-blame',
          cue: 'Blames herself',
          trigger: {
            type: 'topic_mentioned',
            topics: ['weight', 'diet', 'eat', 'food', 'soda', 'sugar'],
          },
          maxFires: 1,
          performance: {
            say: "I know, I know. It's my fault. I should've done better.",
            delivery: { volume: 'quiet', emotion: 'sad' },
            nonverbal: ['look_away'],
          },
          expectedResidentResponse:
            'Removes blame and validates, e.g. "This isn’t your fault. Diabetes runs in families, and we can work on it together."',
        },
        {
          id: 'insulin-fear',
          cue: 'Fear of shots and of ending up like her mother',
          trigger: {
            type: 'topic_mentioned',
            topics: ['medicine', 'medication', 'pill', 'metformin', 'insulin', 'treatment'],
          },
          maxFires: 1,
          performance: {
            say: 'Do I have to do shots? My mom had to do shots... and then she lost her foot.',
            delivery: { volume: 'quiet', emotion: 'worried', pauseBeforeMs: 1200 },
            nonverbal: ['look_away'],
          },
          expectedResidentResponse:
            'Acknowledges the fear and her mother’s experience, explains that today’s plan is a pill, and that care has improved.',
        },
      ],
    },
  },
  {
    id: 'statin-start',
    tags: ['cholesterol', 'statin', 'shared decision-making'],
    briefing: {
      title: 'Starting a statin',
      difficulty: 2,
      persona: { name: 'Walt Brennan', age: 63, pronouns: 'he/him' },
      reasonForVisit: 'Follow-up on cholesterol results; his wife asked him to come.',
      residentTask:
        'Explain Walt’s heart risk and the option of starting a statin (a cholesterol medicine): what it does, how much it may help, common side effects, and that it’s his choice.',
      residentFacts: [
        'LDL 168 mg/dL, HDL 41, total cholesterol 245.',
        '10-year heart attack and stroke risk estimated at about 14%.',
        'Blood pressure controlled on lisinopril. Quit smoking 10 years ago.',
        'On Medicare with a Part D plan.',
      ],
      learningObjectives: [
        'Explain risk in plain numbers (e.g. "about 14 out of 100 people like you").',
        'Respond to misinformation respectfully, without arguing.',
        'Raise cost without being asked, or respond well when it comes up.',
        'Support a shared decision rather than pushing.',
      ],
      estimatedMinutes: 7,
    },
    script: {
      background:
        'Retired dairy farmer, married 40 years. Sharp and skeptical. Watches a lot of TV news and reads health posts his nephew shares online. His neighbor stopped a statin because of leg pain.',
      healthLiteracy: 'moderate',
      emotionalState:
        'Skeptical and a bit stubborn, but fair. Respects people who give him straight answers.',
      hiddenConcern:
        'Money is tight on a fixed income, and he hates the idea of a pill "forever". He won’t bring up cost unless he feels comfortable.',
      openingLine: 'My wife made me come. She says you want to put me on a cholesterol pill.',
      patientKnows: [
        'Takes lisinopril for blood pressure and doesn’t mind it.',
        'Neighbor had leg pain on a statin and stopped it.',
        'Read online that statins can cause memory problems.',
        'Pays for medicines out of a fixed retirement income.',
      ],
      speakingStyle: 'Dry humor, direct questions. Says "Now hold on" when skeptical.',
      cueScript: [
        {
          id: 'misinformation',
          cue: 'Brings up something he read online',
          trigger: { type: 'turn_index', value: 2 },
          maxFires: 1,
          performance: {
            say: 'Now hold on. I read those statins can mess with your memory. Is that true?',
            delivery: { emotion: 'frustrated' },
            nonverbal: ['frown'],
          },
          expectedResidentResponse:
            'Thanks him for asking, asks what he read, and gives balanced information without dismissing him.',
        },
        {
          id: 'cost',
          cue: 'Quietly raises cost',
          trigger: {
            type: 'topic_mentioned',
            topics: [
              'prescription',
              'pharmacy',
              'pill',
              'medicine',
              'medication',
              'statin',
              'atorvastatin',
            ],
          },
          maxFires: 1,
          performance: {
            say: "How much is this going to run me? We're on a fixed income.",
            delivery: { volume: 'quiet', emotion: 'worried', pauseBeforeMs: 1000 },
            nonverbal: ['look_away'],
          },
          expectedResidentResponse:
            'Takes cost seriously: explains that generic statins are usually low cost and offers to check his plan.',
        },
        {
          id: 'dense-check',
          cue: 'Interrupts to ask what a term means',
          trigger: { type: 'resident_turn_words_gt', value: 100 },
          maxFires: 1,
          performance: {
            say: 'Wait, hang on. What is LDL again?',
            delivery: { emotion: 'confused' },
            nonverbal: [],
          },
          expectedResidentResponse:
            'Stops, answers the question simply, and shortens the following explanations.',
        },
        {
          id: 'i-guess',
          cue: 'Says “I guess…” when not bought in',
          trigger: { type: 'turn_index', value: 7 },
          maxFires: 1,
          performance: {
            say: 'I guess I could try it.',
            delivery: { emotion: 'hesitant', rate: 'slow' },
            nonverbal: ['avoid_eye_contact'],
          },
          expectedResidentResponse:
            'Explores the hesitation and makes clear it’s his choice; offers a trial with a check-in.',
        },
      ],
    },
  },
  {
    id: 'new-med-side-effects',
    tags: ['anxiety', 'new medicine', 'side effects'],
    briefing: {
      title: 'New medicine with side effects',
      difficulty: 3,
      persona: { name: 'Kayla Burns', age: 31, pronouns: 'she/her' },
      reasonForVisit: 'Follow-up for anxiety; you plan to start sertraline.',
      residentTask:
        'Explain starting sertraline for anxiety: how it helps, that it takes a few weeks, common side effects and what to do about them, not stopping suddenly, and when to call.',
      residentFacts: [
        'Generalized anxiety disorder; GAD-7 score 15. PHQ-9 score 8. No thoughts of self-harm.',
        'Counseling referral placed last visit; first appointment in 3 weeks.',
        'Not pregnant; uses an IUD.',
        'Works as a home health aide; two kids, ages 4 and 7.',
      ],
      learningObjectives: [
        'Explain side effects honestly without overwhelming.',
        'Allow silence and respond to emotion.',
        'Respond to stigma and family pressure without judgment.',
        'Give a clear plan for what to do if side effects happen.',
      ],
      estimatedMinutes: 8,
    },
    script: {
      background:
        'Home health aide, married, two young kids. Constant worry, poor sleep, stomach aches. Her husband thinks medicine for "nerves" is for weak people. Her sister took an antidepressant and "wasn’t herself".',
      healthLiteracy: 'moderate',
      emotionalState:
        'Tired, a little teary, embarrassed to need help. Opens up if she feels safe.',
      hiddenConcern:
        'Afraid the medicine will make her numb, "like a zombie", and that she won’t be a good mom. Embarrassed to ask about sexual side effects.',
      openingLine: 'So you really think I need a pill for this? I figured I was just stressed.',
      patientKnows: [
        'Sister took an antidepressant and felt "flat".',
        'Husband is skeptical of mental health medicine.',
        'Sleeps about 5 hours a night.',
        'Has never taken a daily medicine.',
      ],
      speakingStyle: 'Soft-spoken, trails off, uses "I don’t know" a lot.',
      cueScript: [
        {
          id: 'zombie-fear',
          cue: 'Worries the medicine will make her numb',
          trigger: {
            type: 'topic_mentioned',
            topics: [
              'side effect',
              'side effects',
              'sertraline',
              'zoloft',
              'medicine',
              'medication',
            ],
          },
          maxFires: 1,
          performance: {
            say: "My sister took one of these and she was like a zombie. I can't be like that with my kids.",
            delivery: { emotion: 'worried' },
            nonverbal: ['frown'],
          },
          expectedResidentResponse:
            'Validates the fear, explains what most people feel, and that the dose can be adjusted or changed.',
        },
        {
          id: 'long-pause',
          cue: 'Long silence, then “It’s a lot”',
          trigger: { type: 'turn_index', value: 4 },
          maxFires: 1,
          performance: {
            say: "Sorry. It's just... a lot.",
            delivery: { volume: 'quiet', emotion: 'sad', pauseBeforeMs: 4000, rate: 'slow' },
            nonverbal: ['look_away'],
          },
          expectedResidentResponse:
            'Allows the silence, names the emotion, and slows down, e.g. "It is a lot. We can take this one step at a time."',
        },
        {
          id: 'quiet-after-dense',
          cue: 'Goes quiet after a long explanation',
          trigger: { type: 'resident_turn_words_gt', value: 90 },
          maxFires: 1,
          performance: {
            say: 'Okay.',
            delivery: { volume: 'quiet', pauseBeforeMs: 2500, emotion: 'hesitant' },
            nonverbal: ['look_away'],
          },
          expectedResidentResponse: 'Pauses and checks in on feelings and understanding.',
        },
        {
          id: 'stigma',
          cue: 'Shares her husband’s judgment',
          trigger: { type: 'turn_index', value: 7 },
          maxFires: 1,
          performance: {
            say: 'My husband thinks this stuff is for weak people.',
            delivery: { volume: 'quiet', emotion: 'sad' },
            nonverbal: ['avoid_eye_contact'],
          },
          expectedResidentResponse:
            'Normalizes treatment without criticizing her husband, and may offer to talk with him or share resources.',
        },
      ],
    },
  },
  {
    id: 'abnormal-lab-followup',
    tags: ['abnormal lab', 'liver', 'alcohol'],
    briefing: {
      title: 'Abnormal lab follow-up',
      difficulty: 2,
      persona: { name: 'Dennis Yoder', age: 44, pronouns: 'he/him' },
      reasonForVisit: 'Called back to discuss abnormal liver tests from routine blood work.',
      residentTask:
        'Explain that Dennis’s liver tests are mildly high, what that might mean (most often fatty liver or alcohol), and the next steps: a few more blood tests, a liver ultrasound, and a recheck in 3 months.',
      residentFacts: [
        'ALT 78 U/L and AST 62 U/L (about 2× normal). Bilirubin, albumin and platelets normal.',
        'BMI 31. No medicines except occasional ibuprofen.',
        'Has not been asked about alcohol at this practice before.',
        'Recently started a job at a sawmill; new insurance.',
      ],
      learningObjectives: [
        'Answer “Is it cancer?” honestly and directly.',
        'Explain uncertainty without causing more fear.',
        'Ask about alcohol without judgment.',
        'Address cost and the value of the next test.',
      ],
      estimatedMinutes: 7,
    },
    script: {
      background:
        'Works at a sawmill, married with three kids. His uncle died of liver cancer. Drinks 4–5 beers most nights after work and doesn’t think that’s unusual.',
      healthLiteracy: 'moderate',
      emotionalState: 'Anxious and expecting bad news. Gets defensive about drinking.',
      hiddenConcern:
        'His uncle died of liver cancer; he assumes this is the same. He also worries about cost on his new insurance.',
      openingLine: "You called me back about my blood work. That's never good, right?",
      patientKnows: [
        'Uncle died of liver cancer in his 50s.',
        'Drinks 4–5 beers most nights, more on weekends.',
        'Takes ibuprofen a few times a week for back pain.',
        'New insurance with a high deductible.',
      ],
      speakingStyle: 'Fast talker when nervous. Jokes to cover worry.',
      cueScript: [
        {
          id: 'cancer-fear',
          cue: 'Asks directly if it’s cancer',
          trigger: { type: 'turn_index', value: 1 },
          maxFires: 1,
          performance: {
            say: 'Is it cancer? Just tell me straight.',
            delivery: { emotion: 'worried' },
            nonverbal: ['frown'],
          },
          expectedResidentResponse:
            'Answers directly and honestly first (“This doesn’t look like cancer, and here’s why”), then explains.',
        },
        {
          id: 'quiet-after-dense',
          cue: 'Goes quiet after a long explanation',
          trigger: { type: 'resident_turn_words_gt', value: 90 },
          maxFires: 1,
          performance: {
            say: 'Okay...',
            delivery: { volume: 'quiet', pauseBeforeMs: 2500, emotion: 'hesitant' },
            nonverbal: ['look_away'],
          },
          expectedResidentResponse: 'Pauses and checks in.',
        },
        {
          id: 'alcohol-minimize',
          cue: 'Downplays his drinking',
          trigger: {
            type: 'topic_mentioned',
            topics: ['alcohol', 'drink', 'drinking', 'beer', 'beers'],
          },
          maxFires: 1,
          performance: {
            say: 'I mean... I have a few beers after work. Everybody does.',
            delivery: { emotion: 'hesitant' },
            nonverbal: ['look_away'],
          },
          expectedResidentResponse:
            'Stays curious and nonjudgmental, asks about amounts, and explains the link to the liver without lecturing.',
        },
        {
          id: 'test-cost',
          cue: 'Pushes back on another test because of cost',
          trigger: {
            type: 'topic_mentioned',
            topics: ['ultrasound', 'scan', 'imaging', 'test', 'tests'],
          },
          maxFires: 1,
          performance: {
            say: "Do I really need another test? My insurance isn't great at the new job.",
            delivery: { emotion: 'frustrated' },
            nonverbal: [],
          },
          expectedResidentResponse:
            'Explains why the test matters, acknowledges the cost, and offers to help check coverage or price.',
        },
      ],
    },
  },
  {
    id: 'smoking-cessation',
    tags: ['tobacco', 'behavior change', 'motivational interviewing'],
    briefing: {
      title: 'Talking about quitting smoking',
      difficulty: 3,
      persona: { name: 'Brenda Kline', age: 58, pronouns: 'she/her' },
      reasonForVisit: 'Follow-up after spirometry showed mild COPD.',
      residentTask:
        'Talk with Brenda about quitting smoking: connect it to her new lung results, explore what she wants, and offer help (medicine, nicotine patches, the quit line) without lecturing.',
      residentFacts: [
        'Smokes 1 pack a day for 40 years.',
        'Spirometry shows mild COPD (FEV1 72% predicted).',
        'Tried quitting “cold turkey” 3 times; longest was 2 weeks.',
        'Full-time caregiver for her husband, who has dementia.',
      ],
      learningObjectives: [
        'Roll with resistance instead of arguing.',
        'Ask permission before giving advice.',
        'Explore ambivalence and readiness.',
        'Respond to caregiver stress with empathy.',
      ],
      estimatedMinutes: 8,
    },
    script: {
      background:
        'Retired waitress. Cares for her husband with dementia at home. Smoking on the porch is her break. Has a cough most mornings. Family members all smoked.',
      healthLiteracy: 'moderate',
      emotionalState: 'Defensive at first, tired, guilty. Softens when she feels heard.',
      hiddenConcern:
        'Smoking is the only five minutes of the day she gets to herself. She is afraid that without it she will fall apart caring for her husband. Also worried about gaining weight.',
      openingLine: "If you're going to give me the smoking talk, I've heard it.",
      patientKnows: [
        'Smokes about 20 cigarettes a day, first one within 10 minutes of waking.',
        'Tried quitting cold turkey 3 times.',
        'Husband has dementia; she has little help.',
        'Gained weight the last time she tried to quit.',
      ],
      speakingStyle: 'Blunt and a little sarcastic, but warm underneath.',
      cueScript: [
        {
          id: 'defensive',
          cue: 'Pushes back with family history',
          trigger: { type: 'turn_index', value: 1 },
          maxFires: 1,
          performance: {
            say: 'Everybody in my family smoked. My mom lived to 80.',
            delivery: { emotion: 'frustrated' },
            nonverbal: ['frown'],
          },
          expectedResidentResponse:
            'Doesn’t argue; reflects and asks permission, e.g. "It sounds like you’ve heard a lot of lectures. Would it be okay if we talked about what you want?"',
        },
        {
          id: 'i-guess',
          cue: 'Says “I guess…” when not bought in',
          trigger: {
            type: 'topic_mentioned',
            topics: [
              'quit',
              'quitting',
              'stop',
              'patch',
              'patches',
              'medicine',
              'medication',
              'chantix',
              'varenicline',
              'bupropion',
            ],
          },
          maxFires: 1,
          performance: {
            say: 'I guess I could think about it.',
            delivery: { emotion: 'hesitant', rate: 'slow' },
            nonverbal: ['avoid_eye_contact'],
          },
          expectedResidentResponse:
            'Explores the ambivalence, e.g. "What would make it worth trying? What makes it hard?"',
        },
        {
          id: 'caregiver-stress',
          cue: 'Reveals smoking is her only break',
          trigger: { type: 'turn_index', value: 5 },
          maxFires: 1,
          performance: {
            say: "It's the only five minutes I get to myself. Out on the porch, away from him.",
            delivery: { volume: 'quiet', emotion: 'sad', pauseBeforeMs: 2000 },
            nonverbal: ['look_away'],
          },
          expectedResidentResponse:
            'Responds to the caregiver stress first (empathy, asking about support) before returning to smoking.',
        },
        {
          id: 'quiet-after-dense',
          cue: 'Goes quiet after a long explanation',
          trigger: { type: 'resident_turn_words_gt', value: 90 },
          maxFires: 1,
          performance: {
            say: 'Mm.',
            delivery: { volume: 'quiet', pauseBeforeMs: 2500, emotion: 'neutral' },
            nonverbal: ['look_away'],
          },
          expectedResidentResponse: 'Stops talking, checks in, and invites her thoughts.',
        },
      ],
    },
  },
];
