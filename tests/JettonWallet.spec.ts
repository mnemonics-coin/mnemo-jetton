import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Address, Cell, fromNano, toNano, Transaction } from '@ton/core';
import { buildTokenOnchainMetadataCell, JettonMinter } from '../wrappers/JettonMinter';
import { JettonWallet } from '../wrappers/JettonWallet';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';
import { Op } from '../wrappers/JettonConstants';
import { findCompiles } from '@ton/blueprint/dist/utils';
import { findTransactionRequired } from '@ton/test-utils';
import { computedGeneric } from './gasUtils';

describe('JettonMinter', () => {
  let code: Cell;
  let walletCode: Cell;

  beforeAll(async () => {
    code = await compile('JettonMinter');
    walletCode = await compile('JettonWallet');
  });

  let blockchain: Blockchain;
  let deployer: SandboxContract<TreasuryContract>;
  let notDeployer: SandboxContract<TreasuryContract>;

  let jettonMinter: SandboxContract<JettonMinter>;
  let userWallet: (address: Address) => Promise<SandboxContract<JettonWallet>>;
  let printTxGasStats: (name: string, trans: Transaction) => bigint;

  beforeEach(async () => {
    blockchain = await Blockchain.create();
    const content = buildTokenOnchainMetadataCell({
      name: 'Sample Jetton',
      description: 'Sample Jetton',
      symbol: 'JTN',
      image: '',
      decimals: '9',
    });
    printTxGasStats = (name, transaction) => {
      const txComputed = computedGeneric(transaction);
      console.log(`${name} used ${txComputed.gasUsed} gas`);
      console.log(`${name} gas cost: ${txComputed.gasFees}`);
      return txComputed.gasFees;
    };

    deployer = await blockchain.treasury('deployer');
    notDeployer = await blockchain.treasury('notDeployer');

    jettonMinter = blockchain.openContract(
      JettonMinter.createFromConfig({ admin: deployer.address, content: content, wallet_code: walletCode }, code),
    );

    const deployResult = await jettonMinter.sendDeploy(deployer.getSender(), toNano('1'));

    expect(deployResult.transactions).toHaveTransaction({
      from: deployer.address,
      to: jettonMinter.address,
      deploy: true,
    });

    userWallet = async (address: Address) =>
      blockchain.openContract(JettonWallet.createFromAddress(await jettonMinter.getWalletAddress(address)));
  });

  it('should transfer', async () => {
    const deployerJettonWallet = await userWallet(deployer.address);
    const notDeployerJettonWallet = await userWallet(notDeployer.address);

    const mintAmount = toNano(10000);
    await jettonMinter.sendMint(deployer.getSender(), deployer.address, mintAmount, toNano(0.5));

    const amount = toNano(100);

    const result = await deployerJettonWallet.sendTransfer(
      deployer.getSender(),
      toNano(0.1),
      amount,
      notDeployer.address,
      deployer.address,
      null,
      toNano(0.05),
      null,
    );

    expect(result.transactions).toHaveTransaction({
      // excesses
      from: notDeployerJettonWallet.address,
      to: deployer.address,
      op: Op.excesses,
      success: true,
    });

    expect(result.transactions).toHaveTransaction({
      // notification
      from: notDeployerJettonWallet.address,
      to: notDeployer.address,
      op: Op.transfer_notification,
    });

    const transferTx = findTransactionRequired(result.transactions, {
      on: deployerJettonWallet.address,
      from: deployer.address,
      op: Op.transfer,
      success: true,
    });
    printTxGasStats('Jetton transfer', transferTx);

    const receiveTx = findTransactionRequired(result.transactions, {
      on: notDeployerJettonWallet.address,
      from: deployerJettonWallet.address,
      op: Op.internal_transfer,
      success: true,
    });
    printTxGasStats('Receive jetton', receiveTx);

    const balance = await notDeployerJettonWallet.getJettonBalance();
    expect(fromNano(balance)).toEqual('100');
  });

  it('should NOT transfer too much', async () => {
    const deployerJettonWallet = await userWallet(deployer.address);

    const mintAmount = toNano(10);
    await jettonMinter.sendMint(deployer.getSender(), deployer.address, mintAmount, toNano(0.5));

    const amount = toNano(100);

    const result = await deployerJettonWallet.sendTransfer(
      deployer.getSender(),
      toNano(0.1),
      amount,
      notDeployer.address,
      deployer.address,
      null,
      toNano(0.05),
      null,
    );

    expect(result.transactions).toHaveTransaction({
      from: deployer.address,
      to: deployerJettonWallet.address,
      aborted: true,
      exitCode: 706, // error::not_enough_jettons
    });
  });

  it('should burn', async () => {
    const deployerJettonWallet = await userWallet(deployer.address);

    const mintAmount = toNano(10);
    await jettonMinter.sendMint(deployer.getSender(), deployer.address, mintAmount, toNano(0.5));

    const result = await deployerJettonWallet.sendBurn(
      deployer.getSender(),
      toNano(0.5),
      toNano(1),
      deployer.address,
      null,
    );

    expect(result.transactions).toHaveTransaction({
      from: deployerJettonWallet.address,
      to: jettonMinter.address,
      op: Op.burn_notification,
    });

    const tatolSupply = await jettonMinter.getTotalSupply();
    expect(fromNano(tatolSupply)).toEqual('9');

    const balance = await deployerJettonWallet.getJettonBalance();
    expect(fromNano(balance)).toEqual('9');
  });
});
