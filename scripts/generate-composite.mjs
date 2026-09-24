import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import YAML from 'yaml';

const src = YAML.parse(readFileSync('action.yml', 'utf8'));
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const inputs = src.inputs;
const outputs = Object.fromEntries(
  Object.entries(src.outputs).map(([key, value]) => [
    key,
    {
      description: value.description,
      value: `\${{ steps.ti.outputs.${key} }}`,
    },
  ]),
);
const withInputs = Object.fromEntries(
  Object.keys(inputs).map(key => [key, `\${{ inputs.${key} }}`]),
);

const doc = {
  name: 'JEV Test Intelligence (composite)',
  description: 'Checkout the repository and run JEV Test Intelligence, re-exporting its outputs.',
  author: 'JevForge',
  branding: src.branding,
  inputs,
  outputs,
  runs: {
    using: 'composite',
    steps: [
      {
        name: 'Checkout',
        uses: 'actions/checkout@v4',
        with: { token: '${{ inputs.token }}' },
      },
      {
        name: 'Test Intelligence',
        id: 'ti',
        uses: `JevForge/jev-test-intelligence@v${pkg.version}`,
        with: withInputs,
      },
    ],
  },
};

mkdirSync('composite', { recursive: true });
writeFileSync('composite/action.yml', YAML.stringify(doc));
console.log(`wrote composite with ${Object.keys(inputs).length} inputs`);
