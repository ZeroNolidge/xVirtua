/**
 * Seed jargon dictionary (DRAFT, for faculty review).
 *
 * One term per line:  term | plain alternatives (;) | variants (,) | category | x
 * The trailing "x" means the term is fine to use IF the resident explains it
 * in plain words nearby (e.g. "hypertension, which means high blood pressure").
 * Terms without "x" should simply be swapped for the plain word.
 */
export const JARGON_SOURCE = `
utilize|use|utilization,utilizing,utilized|general|
facilitate|help;make easier|facilitating|general|
subsequently|later;after that||general|
prior to|before||general|
approximately|about||general|
initiate|start|initiating,initiated|general|
discontinue|stop|discontinuing,discontinued|general|
terminate|stop;end||general|
commence|start||general|
administer|give|administered,administering|general|
ambulate|walk|ambulating,ambulation|general|
adherence|sticking with the plan;taking it as prescribed|adherent,adhere|general|
compliance|taking it as planned;sticking with it|compliant|general|
noncompliant|not taking it as planned|noncompliance,non-compliant,non-compliance|general|
regimen|plan;schedule||general|
modality|type of treatment|modalities|general|
optimal|best||general|
optimize|make the most of;get the best results|optimizing,optimization|general|
sufficient|enough|insufficient|general|
indicate|show|indicates,indicated|general|
demonstrate|show|demonstrates,demonstrated|general|
prognosis|outlook;what to expect||general|x
etiology|cause|aetiology|general|
idiopathic|no known cause||general|
comorbidity|other health problem|comorbidities,comorbid|general|
contraindicated|not safe for you|contraindication,contraindications|general|
efficacy|how well it works|efficacious|general|
adverse effect|side effect;bad reaction|adverse effects,adverse event,adverse events,adverse reaction|general|
therapeutic|helpful;used as treatment||general|
prophylaxis|prevention|prophylactic|general|
asymptomatic|no symptoms;you may not feel anything||general|
symptomatic|having symptoms||general|
exacerbation|flare-up|exacerbations,exacerbate|general|
remission|quiet period;no signs of disease right now||general|x
progressive|gets worse over time||general|x
acute|sudden;short-term||general|x
chronic|long-lasting;long-term||general|x
benign|not cancer;harmless||general|x
malignant|cancer|malignancy|general|
lesion|spot;sore;area|lesions|general|
nodule|small lump|nodules|general|
unremarkable|normal||general|
within normal limits|normal|wnl|general|
elevated|high;higher than normal||general|
deficiency|not enough|deficient|general|
modifiable risk factor|something you can change that raises your risk|modifiable risk factors|general|
risk factor|something that raises your chance of a problem|risk factors|general|x
lifestyle modification|changes to daily habits|lifestyle modifications|general|
intervention|treatment;step we take|interventions|general|
noninvasive|no cutting or needles|non-invasive|general|
invasive|involves cutting or going inside the body||general|
sequelae|after-effects||general|
evidence-based|proven by research||general|
clinically significant|important for your health||general|
statistically significant|unlikely to be chance||general|
baseline|starting point||general|x
parameters|numbers we track||general|
differential diagnosis|list of possible causes|differential|general|
rule out|make sure it isn't|ruled out,r/o|general|
workup|tests;checking things out|work-up|general|
pathology|the disease;lab study of tissue||general|
pathophysiology|how the illness works in the body||general|
morbidity|illness;health problems||general|
mortality|death;risk of dying||general|
incidence|how often new cases happen||general|
prevalence|how common it is||general|
hereditary|runs in families||general|x
genetic predisposition|runs in your family|predisposition,predisposed|general|
familial|runs in families||general|
congenital|born with it||general|
systemic|affects the whole body||general|
localized|in one spot||general|
bilateral|both sides|bilaterally|general|
unilateral|one side||general|
anterior|front||general|
posterior|back||general|
proximal|closer to the body||general|
distal|farther from the body||general|
palpate|feel|palpation,palpated|general|
auscultate|listen|auscultation|general|
inpatient|staying in the hospital||general|
ambulatory|walking;outpatient||general|
triage|sorting by how urgent||general|
discharge|go home from the hospital;fluid coming out||general|x
sedentary|sitting most of the day||general|
first-line|first choice|first line|general|
monotherapy|one medicine||general|
combination therapy|more than one medicine||general|
well-controlled|in a good range|well controlled|general|
uncontrolled|too high;not in a good range|poorly controlled|general|
refractory|hard to treat||general|
primary prevention|preventing a first heart attack or stroke||general|
secondary prevention|preventing it from happening again||general|
risk stratification|figuring out your risk||general|
cardiovascular risk|heart risk|cardiac risk|general|x
shared decision-making|deciding together|shared decision making|general|
pharmacologic|with medicine|pharmacological|general|
nonpharmacologic|without medicine|non-pharmacologic,nonpharmacological|general|
labs|blood tests|lab work|test|x
specimen|sample|specimens|test|
serum|blood||test|
plasma|the liquid part of blood||test|
reference range|normal range||test|
incidental finding|something we weren't looking for|incidentaloma|test|
imaging|scans;pictures of the inside of your body||test|x
radiograph|x-ray|radiographs|test|
biopsy|small tissue sample|biopsies|test|x
lipid panel|cholesterol test|lipid profile,fasting lipid panel|test|
lipids|cholesterol and fats in the blood|lipid|test|x
ldl|bad cholesterol|low-density lipoprotein,ldl cholesterol,ldl-c|test|x
hdl|good cholesterol|high-density lipoprotein,hdl cholesterol|test|x
triglycerides|a type of fat in the blood|triglyceride|test|x
hemoglobin a1c|3-month blood sugar test|a1c,hba1c,glycated hemoglobin,glycosylated hemoglobin|test|x
fasting plasma glucose|fasting blood sugar|fasting glucose,fpg|test|
glucose|blood sugar|blood glucose|test|x
fingerstick|finger-prick sugar check|finger stick|test|
glucometer|blood sugar meter|glucose meter|test|
cgm|sugar sensor;a sensor that checks your sugar all day|continuous glucose monitor|test|x
oral glucose tolerance test|sugar drink test|ogtt|test|
cbc|blood count|complete blood count|test|
hemoglobin|red blood cell level||test|x
hematocrit|red blood cell level||test|
white blood cell count|infection-fighting cells|wbc|test|
cmp|routine blood chemistry test|comprehensive metabolic panel,bmp,basic metabolic panel|test|
creatinine|kidney function test||test|x
egfr|kidney filtering number|gfr,estimated glomerular filtration rate,glomerular filtration rate|test|x
bun|kidney blood test|blood urea nitrogen|test|
urinalysis|urine test|ua|test|
microalbumin|protein in the urine test|urine microalbumin,uacr|test|
liver function tests|liver tests|lfts,lft,liver panel|test|
transaminases|liver tests|transaminitis|test|
alt|liver enzyme|alanine aminotransferase|test|x
ast|liver enzyme|aspartate aminotransferase|test|x
liver enzymes|liver tests||test|x
tsh|thyroid test|thyroid stimulating hormone|test|x
inr|clotting test|pt/inr|test|x
creatine kinase|muscle enzyme test|ck,cpk|test|
ekg|heart tracing|ecg,electrocardiogram|test|x
echocardiogram|heart ultrasound|echo|test|
stress test|treadmill heart test||test|x
ct scan|detailed x-ray scan|ct,cat scan,computed tomography|test|x
mri|detailed scan using magnets|magnetic resonance imaging|test|x
spirometry|breathing test|pulmonary function test,pulmonary function tests,pfts|test|
pulse oximetry|oxygen level check|pulse ox,o2 sat,spo2,oxygen saturation|test|
mmhg|the units for blood pressure|millimeters of mercury|test|
systolic|top number||test|
diastolic|bottom number||test|
vital signs|your blood pressure, pulse and temperature|vitals|test|x
titer|level|titers|test|
culture|lab test to grow germs|cultures|test|x
hypertension|high blood pressure|htn,hypertensive|condition|x
hypotension|low blood pressure|hypotensive|condition|
orthostatic hypotension|dizziness when you stand up|orthostatic,orthostasis|condition|
hyperlipidemia|high cholesterol||condition|
dyslipidemia|unhealthy cholesterol levels||condition|
hypercholesterolemia|high cholesterol||condition|
hypertriglyceridemia|too much fat in the blood||condition|
diabetes mellitus|diabetes|dm,t2dm,dm2,type 2 diabetes mellitus,t2d,niddm|condition|
hyperglycemia|high blood sugar|hyperglycemic|condition|
hypoglycemia|low blood sugar|hypoglycemic,hypo,hypos|condition|
prediabetes|blood sugar higher than normal, but not diabetes yet|pre-diabetes,prediabetic|condition|x
insulin resistance|your body doesn't respond well to insulin|insulin resistant|condition|x
metabolic syndrome|a group of problems that raise heart risk||condition|x
obesity|a weight that's unhealthy for your body|obese,morbid obesity,morbidly obese|condition|x
bmi|a number based on your height and weight|body mass index|condition|x
myocardial infarction|heart attack|mi,myocardial infarctions,stemi,nstemi|condition|
coronary artery disease|clogged heart arteries|cad,coronary heart disease,chd|condition|
atherosclerosis|plaque buildup in the arteries;hardening of the arteries|atherosclerotic|condition|
arteriosclerosis|hardening of the arteries||condition|
ischemia|not enough blood flow|ischemic|condition|
angina|chest pain from the heart||condition|x
cerebrovascular accident|stroke|cva|condition|
transient ischemic attack|mini-stroke|tia|condition|
cardiovascular disease|heart and blood vessel disease|cvd,cardiovascular|condition|
ascvd|heart disease and stroke from clogged arteries|atherosclerotic cardiovascular disease|condition|
congestive heart failure|heart isn't pumping as well as it should|chf,hfref,hfpef|condition|
arrhythmia|irregular heartbeat|arrhythmias,dysrhythmia|condition|
atrial fibrillation|irregular heartbeat|afib,a-fib,a fib|condition|x
tachycardia|fast heartbeat|tachycardic|condition|
bradycardia|slow heartbeat|bradycardic|condition|
palpitations|feeling your heart race or skip||condition|x
edema|swelling|oedema,peripheral edema|condition|
dyspnea|shortness of breath|dyspneic,sob|condition|
orthopnea|trouble breathing when lying flat||condition|
syncope|fainting|syncopal|condition|
vertigo|spinning dizziness||condition|x
neuropathy|nerve damage|peripheral neuropathy,neuropathic|condition|x
retinopathy|damage to the back of the eye|diabetic retinopathy|condition|
nephropathy|kidney damage|diabetic nephropathy|condition|
renal|kidney||condition|
renal failure|kidney failure|renal insufficiency|condition|
chronic kidney disease|kidneys not filtering as well over time|ckd|condition|x
hepatic|liver||condition|
hepatic steatosis|fatty liver|steatosis,nafld,masld,fatty liver disease,nash,mash|condition|x
hepatitis|liver inflammation||condition|x
cirrhosis|scarring of the liver||condition|x
gastrointestinal|stomach and intestines|gi|condition|
gerd|acid reflux;heartburn|gastroesophageal reflux disease,gastroesophageal reflux|condition|
dyspepsia|indigestion||condition|
copd|lung disease that makes it hard to breathe|chronic obstructive pulmonary disease|condition|x
emphysema|lung damage that makes it hard to breathe||condition|x
pulmonary|lung||condition|
respiratory|breathing||condition|
hypothyroidism|underactive thyroid|hypothyroid|condition|
hyperthyroidism|overactive thyroid|hyperthyroid|condition|
anemia|low red blood cells;low blood count|anemic,anaemia|condition|x
thrombosis|blood clot|thrombus,thrombi|condition|
deep vein thrombosis|blood clot in the leg|dvt|condition|
pulmonary embolism|blood clot in the lung|pulmonary emboli|condition|
embolism|a clot that travels|emboli,embolus|condition|
aneurysm|a bulge in a blood vessel|aneurysms|condition|x
carcinoma|cancer|carcinomas|condition|
neoplasm|growth;tumor|neoplasms,neoplastic|condition|
metastasis|cancer that has spread|metastases,metastatic,mets|condition|
polyp|small growth|polyps|condition|x
osteoporosis|thin, weak bones||condition|x
osteopenia|bones thinner than normal||condition|
osteoarthritis|wear-and-tear arthritis|oa,degenerative joint disease,djd|condition|
major depressive disorder|depression|mdd|condition|
generalized anxiety disorder|anxiety|gad|condition|
insomnia|trouble sleeping||condition|x
obstructive sleep apnea|pauses in breathing during sleep|osa,sleep apnea,apnea|condition|x
nicotine dependence|addiction to nicotine|nicotine addiction|condition|x
tobacco use disorder|being hooked on tobacco||condition|
cessation|quitting|smoking cessation,tobacco cessation|condition|
abstinence|not using at all|abstinent|condition|
pack-years|how much you've smoked over the years|pack years,pack-year,pack year|condition|
hematuria|blood in the urine||condition|
proteinuria|protein in the urine|albuminuria,microalbuminuria|condition|
polyuria|peeing a lot||condition|
polydipsia|feeling very thirsty||condition|
nocturia|getting up at night to pee||condition|
malaise|feeling unwell||condition|
emesis|vomiting|emesis episodes|condition|
myalgia|muscle aches|myalgias|condition|
arthralgia|joint pain|arthralgias|condition|
rhabdomyolysis|serious muscle breakdown|rhabdo|condition|
cephalgia|headache||condition|
pruritus|itching|pruritic|condition|
urticaria|hives||condition|
dermatitis|skin irritation||condition|
erythema|redness|erythematous|condition|
lethargy|very tired;sluggish|lethargic|condition|
paresthesia|tingling;numbness|paresthesias|condition|
claudication|leg pain when walking||condition|
sepsis|the body's overreaction to a serious infection|septic|condition|x
hypokalemia|low potassium||condition|
hyperkalemia|high potassium||condition|
hyponatremia|low sodium||condition|
electrolytes|body salts like sodium and potassium|electrolyte|condition|x
erectile dysfunction|trouble getting or keeping an erection||condition|
urinary tract infection|bladder infection|uti,utis|condition|
upper respiratory infection|a cold|uri|condition|
cardiac|heart||body|
myocardium|heart muscle|myocardial|body|
coronary|the heart's blood vessels|coronary arteries|body|x
vascular|blood vessel|vasculature|body|
arterial|artery||body|
venous|vein||body|
pancreatic|pancreas||body|
adrenal|the small glands on your kidneys|adrenal glands|body|
cerebral|brain||body|
neurological|nerves and brain|neurologic|body|
musculoskeletal|muscles and bones||body|
dermatologic|skin|dermatological|body|
ophthalmic|eye|ocular|body|
abdomen|belly|abdominal|body|
thorax|chest|thoracic|body|
lower extremities|legs|lower extremity|body|
upper extremities|arms|upper extremity|body|
extremities|arms and legs|extremity|body|
lumbar|lower back||body|
carotid|the big arteries in your neck|carotid arteries,carotids|body|
aorta|the body's main artery|aortic|body|x
ventricle|the heart's pumping chamber|ventricles,ventricular|body|
atrium|the heart's top chamber|atria,atrial|body|
glomerular|kidney filter||body|
statin|cholesterol medicine|statins,hmg-coa reductase inhibitor|med|x
antihypertensive|blood pressure medicine|antihypertensives|med|
diuretic|water pill|diuretics,thiazide,thiazides|med|
ace inhibitor|blood pressure pill that also protects the kidneys|ace inhibitors,acei,ace-i|med|x
arb|blood pressure pill|arbs,angiotensin receptor blocker,angiotensin receptor blockers|med|x
beta blocker|medicine that slows the heart and lowers blood pressure|beta blockers,beta-blocker,beta-blockers|med|x
calcium channel blocker|blood pressure pill|calcium channel blockers,ccb|med|x
oral hypoglycemic|diabetes pill|oral hypoglycemics,hypoglycemic agent,oral agent|med|
glp-1 agonist|weekly diabetes and weight shot|glp-1,glp1,glp-1 receptor agonist,glp-1 ra,glp-1s|med|x
sglt2 inhibitor|diabetes pill that removes sugar through the urine|sglt2,sglt-2 inhibitor,sglt2 inhibitors|med|x
sulfonylurea|diabetes pill that makes your body release insulin|sulfonylureas|med|x
basal insulin|long-acting insulin||med|x
bolus|mealtime dose|bolus insulin|med|
anticoagulant|blood thinner|anticoagulants,anticoagulation|med|
antiplatelet|medicine that keeps blood from clotting too easily|antiplatelets|med|
nsaid|anti-inflammatory pain reliever like ibuprofen|nsaids,non-steroidal anti-inflammatory,nonsteroidal anti-inflammatory|med|x
analgesic|pain reliever|analgesics,analgesia|med|
antipyretic|fever reducer|antipyretics|med|
antiemetic|anti-nausea medicine|antiemetics|med|
anxiolytic|anxiety medicine|anxiolytics|med|
ssri|a type of antidepressant|ssris,selective serotonin reuptake inhibitor|med|x
corticosteroid|steroid|corticosteroids|med|
nicotine replacement therapy|nicotine patch, gum or lozenge|nrt|med|x
over-the-counter|without a prescription|otc,over the counter|med|
formulary|list of medicines your insurance covers||med|
prior authorization|insurance approval|prior auth|med|
pharmacotherapy|medicine treatment||med|
polypharmacy|taking a lot of medicines||med|
medication reconciliation|going over all your medicines together|med rec,med reconciliation|med|
side effect profile|possible side effects||med|
tolerability|how well you handle it|tolerate,tolerated,tolerating|med|x
half-life|how long it stays in your body|half life|med|
dosage|amount||med|
po|by mouth|per os|med|
intravenous|through a vein|iv|med|
intramuscular|a shot in the muscle||med|
subcutaneous|under the skin|subq,sub-q,subcut|med|
topical|on the skin||med|
sublingual|under the tongue||med|
bid|twice a day|b.i.d.|med|
tid|three times a day|t.i.d.|med|
qid|four times a day|q.i.d.|med|
qd|once a day|q.d.|med|
qhs|at bedtime|q.h.s.|med|
prn|as needed|p.r.n.|med|
stat|right away||med|
taper|lower the dose slowly|tapering,tapered|med|x
titrate|adjust the dose slowly|titration,titrating,up-titrate,uptitrate|med|
maintenance dose|regular dose||med|
loading dose|bigger first dose||med|
myopathy|muscle problems|myopathies|med|
hepatotoxicity|liver damage|hepatotoxic|med|
nephrotoxic|harmful to the kidneys|nephrotoxicity|med|
hypersensitivity|allergic reaction|hypersensitivity reaction|med|
anaphylaxis|severe allergic reaction|anaphylactic|med|
gi upset|upset stomach|gi side effects|med|
dietary modification|changes to what you eat|dietary modifications,dietary changes|treatment|
sodium restriction|cutting back on salt|sodium intake,low-sodium diet,low sodium diet|treatment|x
dash diet|an eating plan that lowers blood pressure|dash|treatment|x
carbohydrates|carbs, like bread, rice and sweets|carbohydrate,carbohydrate intake|treatment|x
saturated fat|the kind of fat in butter and red meat|saturated fats|treatment|x
caloric intake|how much you eat|calorie intake|treatment|
aerobic exercise|activity that gets your heart pumping, like walking|aerobic activity,cardio|treatment|x
moderate-intensity|brisk, like fast walking|moderate intensity|treatment|
weight reduction|losing weight||treatment|
bariatric surgery|weight-loss surgery|bariatric|treatment|
referral|sending you to a specialist|refer,referring,referred|treatment|x
cardiology|heart doctor|cardiologist|treatment|
endocrinology|hormone and diabetes doctor|endocrinologist,endo|treatment|
nephrology|kidney doctor|nephrologist|treatment|
pulmonology|lung doctor|pulmonologist,pulmonary clinic|treatment|
gastroenterology|stomach doctor|gastroenterologist|treatment|
ophthalmology|eye doctor|ophthalmologist|treatment|
podiatry|foot doctor|podiatrist|treatment|
primary care physician|regular doctor|pcp,primary care provider|treatment|
angioplasty|opening a blocked artery with a tiny balloon||treatment|x
cardiac catheterization|a test that looks at the heart's arteries with a thin tube|heart cath,cardiac cath,catheterization|treatment|x
revascularization|restoring blood flow||treatment|
dialysis|a machine that cleans your blood when the kidneys can't||treatment|x
self-monitoring|checking at home|smbg,self-monitoring of blood glucose|treatment|
behavioral therapy|counseling to change habits|cognitive behavioral therapy,cbt|treatment|x
hx|history|pmh,past medical history|abbrev|
fhx|family history|fh|abbrev|
sx|symptoms||abbrev|
dx|diagnosis||abbrev|
rx|prescription|rxs|abbrev|
f/u|follow-up|fu|abbrev|
cp|chest pain||abbrev|
n/v|nausea and vomiting||abbrev|
bm|bowel movement|bms|abbrev|
bp|blood pressure|bps|abbrev|
`;
