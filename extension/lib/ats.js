// ATS keyword matching: what does the job ask for, and does your resume say it?
//
// Honest by design: a missing keyword is split into
//   - "on your profile but not on your resume"  → you can legitimately add it
//   - "a real gap"                               → you don't list it anywhere, so don't claim it
// This is a heuristic (real ATSs vary), so the score is a guide, not a promise.

// [display name, [aliases…]] — aliases are matched as whole terms, case-insensitively.
const LEXICON = [
  // languages
  ['Python', ['python']], ['C', ['c language', 'embedded c', 'c programming']], ['C++', ['c++', 'cpp', 'c plus plus']], ['Java', ['java']], ['JavaScript', ['javascript', 'node.js', 'nodejs']],
  ['TypeScript', ['typescript']], ['Rust', ['rust']], ['Go', ['golang']], ['MATLAB', ['matlab', 'simulink']], ['Bash', ['bash', 'shell scripting']], ['SQL', ['sql', 'postgresql', 'mysql']],
  ['Verilog', ['verilog', 'systemverilog', 'vhdl']],
  // ML / AI
  ['Machine Learning', ['machine learning', 'ml']], ['Deep Learning', ['deep learning', 'dl', 'neural network', 'neural networks']], ['Computer Vision', ['computer vision', 'image processing', 'cv']],
  ['NLP', ['nlp', 'natural language processing']], ['LLMs', ['llm', 'llms', 'large language model', 'large language models', 'generative ai', 'genai']], ['Reinforcement Learning', ['reinforcement learning']],
  ['PyTorch', ['pytorch', 'torch']], ['TensorFlow', ['tensorflow', 'keras']], ['scikit-learn', ['scikit-learn', 'sklearn']], ['OpenCV', ['opencv']], ['NumPy', ['numpy']], ['Pandas', ['pandas']],
  ['CNN', ['cnn', 'cnns', 'convolutional']], ['Transformers', ['transformer', 'transformers']], ['Object Detection', ['object detection', 'yolo']], ['Segmentation', ['segmentation']],
  ['MLOps', ['mlops', 'ml pipelines', 'ml ops']], ['Hugging Face', ['hugging face', 'huggingface']], ['Data Science', ['data science', 'data scientist']],
  // edge / on-device
  ['Edge AI', ['edge ai', 'edge computing', 'edge inference', 'on-device', 'on device']], ['TinyML', ['tinyml']], ['TFLite', ['tflite', 'tensorflow lite', 'tf lite', 'litert']],
  ['ONNX', ['onnx', 'onnx runtime']], ['TensorRT', ['tensorrt']], ['OpenVINO', ['openvino']], ['TVM', ['apache tvm', 'tvm']], ['CUDA', ['cuda']], ['Quantization', ['quantization', 'quantisation', 'quantized', 'quantised', 'int8']],
  ['Model Compression', ['model compression', 'pruning', 'distillation', 'knowledge distillation']], ['Model Optimization', ['model optimization', 'model optimisation', 'inference optimization', 'latency optimization']],
  ['NPU / Accelerators', ['npu', 'tpu', 'accelerator', 'accelerators', 'hardware acceleration']], ['Jetson', ['jetson', 'nvidia jetson']], ['Raspberry Pi', ['raspberry pi']], ['Coral', ['coral edge', 'edge tpu']],
  // embedded
  ['Embedded Systems', ['embedded systems', 'embedded software', 'embedded', 'firmware']], ['RTOS', ['rtos', 'freertos', 'zephyr']], ['STM32', ['stm32']], ['ESP32', ['esp32']], ['Arduino', ['arduino']],
  ['ARM Cortex', ['arm cortex', 'cortex-m', 'cortex-a', 'arm']], ['RISC-V', ['risc-v', 'riscv']], ['FPGA', ['fpga']], ['DSP', ['dsp', 'digital signal processing', 'signal processing']],
  ['Microcontrollers', ['microcontroller', 'microcontrollers', 'mcu']], ['IoT', ['iot', 'internet of things']], ['I2C / SPI / UART', ['i2c', 'spi', 'uart']], ['CAN Bus', ['can bus', 'can protocol']],
  ['MQTT', ['mqtt']], ['BLE', ['ble', 'bluetooth low energy']], ['PCB Design', ['pcb', 'altium', 'kicad']], ['Linux', ['linux', 'embedded linux', 'yocto']], ['ROS', ['ros', 'ros2']],
  ['Wireless / Communication', ['wireless', '5g', 'lte', 'wifi', 'wi-fi', 'communication systems']],
  // tools / cloud
  ['Git', ['git', 'github', 'gitlab']], ['Docker', ['docker', 'containers']], ['Kubernetes', ['kubernetes', 'k8s']], ['AWS', ['aws', 'amazon web services']], ['GCP', ['gcp', 'google cloud']], ['Azure', ['azure']],
  ['CI/CD', ['ci/cd', 'ci cd', 'continuous integration']], ['REST APIs', ['rest api', 'rest apis', 'restful']], ['Flask / FastAPI', ['flask', 'fastapi']], ['Jupyter', ['jupyter']],
  ['Data Structures & Algorithms', ['data structures', 'algorithms', 'dsa']], ['Statistics', ['statistics', 'statistical']], ['Research', ['research', 'publications']],
];

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
/** Whole-term regex that also works for aliases like "c++" and "ci/cd". */
const termRe = (alias) => new RegExp(`(^|[^a-z0-9+#])${escapeRe(alias.toLowerCase())}(?![a-z0-9+#])`, 'gi');

const PREFERRED = /nice[- ]to[- ]have|preferred|bonus|good to have|a plus|is a plus|desirable/i;
const REQUIRED = /requirements?|qualifications?|must[- ]have|what you(?:'|’)ll need|you have|you bring|looking for|proficien|experience (?:with|in)|skills/i;

// capitalised / camel-case tokens that look like tools but aren't in the lexicon (e.g. "ROS2", "Triton")
const NOISE = new Set(['USA', 'ASAP', 'CTC', 'HR', 'CEO', 'CTO', 'LLC', 'INC', 'LTD', 'PVT', 'AND', 'THE', 'FOR', 'WITH', 'YOU', 'OUR', 'WE', 'EOE', 'PDF', 'URL', 'FAQ', 'PHD', 'MBA', 'BTECH', 'MTECH', 'BE', 'ME', 'IIT', 'NIT', 'BITS', 'LINKEDIN', 'INDIA', 'FULL', 'TIME', 'PART', 'WFH', 'IST', 'JD', 'OK', 'AM', 'PM', 'US', 'UK', 'EU', 'UI', 'UX', 'QA']);

/** What the job asks for, most important first: [{ term, weight, count, kind }]. */
export function extractKeywords(jdText, { limit = 28 } = {}) {
  const text = String(jdText || '');
  const lower = text.toLowerCase();
  const found = [];

  for (const [name, aliases] of LEXICON) {
    let count = 0;
    let weight = 0;
    for (const alias of aliases) {
      for (const m of lower.matchAll(termRe(alias))) {
        const at = m.index;
        const window = lower.slice(Math.max(0, at - 700), at);
        const prefAt = window.search(new RegExp(`(?:${PREFERRED.source})(?![\\s\\S]*(?:${PREFERRED.source}))`, 'i'));
        const reqAt = window.search(new RegExp(`(?:${REQUIRED.source})(?![\\s\\S]*(?:${REQUIRED.source}))`, 'i'));
        const preferred = prefAt >= 0 && prefAt >= reqAt;
        count++;
        weight += count === 1 ? (preferred ? 0.5 : reqAt >= 0 ? 2 : 1) : 0.5; // later mentions add a little
      }
    }
    if (count) found.push({ term: name, weight: Math.min(weight, 4), count, kind: 'lexicon', aliases });
  }

  const known = new Set(found.flatMap((f) => f.aliases.map((a) => a.toLowerCase())).concat(found.map((f) => f.term.toLowerCase())));
  const extra = new Map();
  for (const m of text.matchAll(/\b[A-Z][a-z]+[A-Z][A-Za-z0-9]*\b|\b[A-Z]{2,6}[0-9]\b|\b[A-Z][A-Za-z]*[0-9][A-Za-z0-9]*\b|\b[A-Z]{3,6}\b/g)) {
    const token = m[0];
    if (NOISE.has(token.toUpperCase()) || known.has(token.toLowerCase())) continue;
    extra.set(token, (extra.get(token) || 0) + 1);
  }
  const others = [...extra].filter(([, n]) => n >= 1).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([term, count]) => ({ term, weight: 0.5, count, kind: 'other', aliases: [term] }));

  return [...found, ...others]
    .sort((a, b) => b.weight - a.weight || b.count - a.count)
    .slice(0, limit)
    .map(({ aliases, ...k }) => ({ ...k, aliases }));
}

export const mentions = (haystack, kw) => kw.aliases.some((a) => new RegExp(termRe(a).source, 'i').test(haystack)) || new RegExp(termRe(kw.term).source, 'i').test(haystack);

/**
 * Compare the job's keywords with your resume (and, for the honest split, your profile).
 * Returns { score, matched, addable, gaps } — each a list of keyword objects.
 */
export function scoreResume(keywords, resumeText, profileText = '') {
  const resume = String(resumeText || '').toLowerCase();
  const profile = String(profileText || '').toLowerCase();
  const matched = [];
  const addable = []; // on your profile, but not on the resume
  const gaps = []; // nowhere — don't claim these
  for (const kw of keywords) {
    if (mentions(resume, kw)) matched.push(kw);
    else if (profile && mentions(profile, kw)) addable.push(kw);
    else gaps.push(kw);
  }
  const total = keywords.reduce((n, k) => n + k.weight, 0);
  const got = matched.reduce((n, k) => n + k.weight, 0);
  return { score: total ? Math.round((100 * got) / total) : null, matched, addable, gaps };
}

/** Flat text of everything on the profile that a skill could be backed by. */
export function profileSkillText(profile) {
  const p = profile || {};
  // skill VALUES only — the category names ("embedded_hardware") are not skills you can claim
  const skills = Object.values(p.skills || {}).flat().join(' ');
  return [skills, ...(p.projects || []).map((x) => `${x.name} ${(x.tech || []).join(' ')} ${(x.bullets || []).join(' ')}`), ...(p.experience || []).map((x) => `${x.role} ${(x.bullets || []).join(' ')}`), (p.achievements || []).join(' '), (p.certifications || []).join(' ')].join('\n');
}

/** Lexicon tech terms that appear in `text` — used to catch a rewrite that introduces a tool the original bullet never mentioned. */
export function techTermsIn(text) {
  const lower = String(text || '').toLowerCase();
  return LEXICON.filter(([, aliases]) => aliases.some((a) => termRe(a).test(lower))).map(([name]) => name);
}
