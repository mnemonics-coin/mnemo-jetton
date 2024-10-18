import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Address, Cell, fromNano, toNano, Transaction } from '@ton/core';
import { buildTokenOnchainMetadataCell, JettonMinter } from '../wrappers/JettonMinter';
import { JettonWallet } from '../wrappers/JettonWallet';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';
import { Op } from '../wrappers/JettonConstants';
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

  it('should have admin address', async () => {
    const adminAddress = await jettonMinter.getAdminAddress();

    expect(adminAddress).toEqualAddress(deployer.address);
  });

  it('should allow admin to change admin', async () => {
    const zeroAddress = Address.parseRaw('0:0000000000000000000000000000000000000000000000000000000000000000');

    const result = await jettonMinter.sendChangeAdmin(deployer.getSender(), zeroAddress);
    expect(result.transactions).toHaveTransaction({
      from: deployer.address,
      op: Op.change_admin,
      success: true,
    });

    const adminAddress = await jettonMinter.getAdminAddress();

    expect(adminAddress).not.toEqualAddress(deployer.address);
    expect(adminAddress).toEqualAddress(zeroAddress);
  });

  it('should NOT allow non-admin to change admin', async () => {
    const zeroAddress = Address.parseRaw('0:0000000000000000000000000000000000000000000000000000000000000000');

    const result = await jettonMinter.sendChangeAdmin(notDeployer.getSender(), zeroAddress);
    expect(result.transactions).toHaveTransaction({
      from: notDeployer.address,
      op: Op.change_admin,
      success: false,
      exitCode: 73,
    });
  });

  it('should drop admin', async () => {
    const result = await jettonMinter.sendDropAdmin(deployer.getSender());
    expect(result.transactions).toHaveTransaction({
      from: deployer.address,
      op: Op.drop_admin,
      success: true,
    });

    expect(await jettonMinter.getAdminAddress()).toBe(null);
  });

  it('should allow mint jettons by admin', async () => {
    const deployerJettonWallet = await userWallet(deployer.address);

    const mintAmount = toNano(10000);
    const result = await jettonMinter.sendMint(deployer.getSender(), deployer.address, mintAmount, toNano(1));

    expect(result.transactions).toHaveTransaction({
      from: deployer.address,
      to: jettonMinter.address,
      op: Op.mint,
      success: true,
    });

    const totalSupply = await jettonMinter.getTotalSupply();

    expect(fromNano(totalSupply)).toEqual('10000');

    const balance = await deployerJettonWallet.getJettonBalance();
    expect(fromNano(balance)).toEqual('10000');

    const mintTx = findTransactionRequired(result.transactions, {
      from: jettonMinter.address,
      to: deployerJettonWallet.address,
      success: true,
      deploy: true,
    });
    printTxGasStats('Mint transaction:', mintTx);
  });

  it('should NOT allow mint jettons by non-admin', async () => {
    const wallet = await blockchain.treasury('wallet');

    const mintAmount = toNano(10000);
    const result = await jettonMinter.sendMint(wallet.getSender(), wallet.address, mintAmount, toNano(1.5));

    expect(result.transactions).toHaveTransaction({
      from: wallet.address,
      to: jettonMinter.address,
      op: Op.mint,
      success: false,
      exitCode: 73,
    });

    const totalSupply = await jettonMinter.getTotalSupply();
    expect(fromNano(totalSupply)).toEqual('0');
  });
});
