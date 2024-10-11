import { compile, NetworkProvider } from '@ton/blueprint';
import { toNano } from '@ton/core';
import { buildTokenOffchainMetadataCell, buildTokenOnchainMetadataCell, JettonMinter } from '../wrappers/JettonMinter';
import { promptAddress, promptBool, promptUrl } from '../wrappers/ui-utils';

const formatUrl =
  'https://github.com/ton-blockchain/TEPs/blob/master/text/0064-token-data-standard.md#jetton-metadata-example-offchain';

const exampleContent = {
  name: 'MNEMO',
  description: 'Mnemonics',
  symbol: 'MNEMO',
  decimals: '9',
  image: '',
};

export async function run(provider: NetworkProvider) {
  const ui = provider.ui();
  const sender = provider.sender();
  const adminPrompt = `Please specify admin address`;
  ui.write(`Jetton deployer\nCurrent deployer onli supports off-chain format:${formatUrl}`);

  let admin = await promptAddress(adminPrompt, ui, sender.address);
  ui.write(`Admin address:${admin}\n`);

  let dataCorrect = false;
  do {
    ui.write('Please verify data:\n');
    ui.write(`Admin:${admin}\n\n`);
    ui.write(`${exampleContent}`);
    dataCorrect = await promptBool('Is everything ok?(y/n)', ['y', 'n'], ui);
    if (!dataCorrect) {
      const upd = await ui.choose('What do you want to update?', ['Admin', 'Url'], (c) => c);

      if (upd == 'Admin') {
        admin = await promptAddress(adminPrompt, ui, sender.address);
      }
    }
  } while (!dataCorrect);

  // const offcontent = buildTokenOffchainMetadataCell({uri: ""})
  const content = buildTokenOnchainMetadataCell(exampleContent);

  const wallet_code = await compile('JettonWallet');

  const minter = JettonMinter.createFromConfig({ admin, content, wallet_code }, await compile('JettonMinter'));

  await provider.deploy(minter, toNano('0.05'));
}
