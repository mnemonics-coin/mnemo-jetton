import {
  Address,
  beginCell,
  Cell,
  Contract,
  contractAddress,
  ContractProvider,
  Sender,
  SendMode,
  toNano,
  internal,
  Dictionary,
} from '@ton/core';

import { sha256_sync, sha256 } from '@ton/crypto';
import { Op } from './JettonConstants';

// export type JettonMinterContent = {
//     type: 0 | 1;
//     uri: string;
// };

export type JettonMinterConfig = { admin: Address; content: Cell; wallet_code: Cell };

export function jettonMinterConfigToCell(config: JettonMinterConfig): Cell {
  return beginCell()
    .storeCoins(0)
    .storeAddress(config.admin)
    .storeRef(config.content)
    .storeRef(config.wallet_code)
    .endCell();
}

export type JettonMetaDataKeys = 'name' | 'description' | 'image' | 'symbol';
type JettonMinterContent = {
  name: string;
  description: string;
  image: string;
  symbol: string;
  decimals: string;
};
const jettonOnChainMetadataSpec: {
  [key in JettonMetaDataKeys]: 'utf8' | 'ascii' | undefined;
} = {
  name: 'utf8',
  description: 'utf8',
  image: 'ascii',
  symbol: 'utf8',
};
const ONCHAIN_CONTENT_PREFIX = 0x00;
const OFFCHAIN_CONTENT_PREFIX = 0x01;
const SNAKE_PREFIX = 0x00;

export function toSha256(s: string): bigint {
  return BigInt('0x' + sha256_sync(s).toString('hex'));
}

export function toTextCell(s: string): Cell {
  return beginCell().storeUint(0, 8).storeStringTail(s).endCell();
}
// ONCHAIN METADATA
export function buildTokenOnchainMetadataCell(data: JettonMinterContent): Cell {
  const KEYLEN = 256;
  const dict = Dictionary.empty(Dictionary.Keys.BigUint(KEYLEN), Dictionary.Values.Cell());

  dict.set(toSha256('name'), toTextCell(data.name));
  dict.set(toSha256('description'), toTextCell(data.description));
  dict.set(toSha256('image'), toTextCell(data.image));
  dict.set(toSha256('symbol'), toTextCell(data.symbol));
  dict.set(toSha256('decimals'), toTextCell(data.decimals));

  return beginCell().storeUint(ONCHAIN_CONTENT_PREFIX, 8).storeDict(dict).endCell();
}

export function buildTokenOffchainMetadataCell(content: { uri: string }) {
  return beginCell()
    .storeUint(OFFCHAIN_CONTENT_PREFIX, 8)
    .storeStringTail(content.uri) //Snake logic under the hood
    .endCell();
}

export class JettonMinter implements Contract {
  constructor(
    readonly address: Address,
    readonly init?: { code: Cell; data: Cell },
  ) {}

  static createFromAddress(address: Address) {
    return new JettonMinter(address);
  }

  static createFromConfig(config: JettonMinterConfig, code: Cell, workchain = 0) {
    const data = jettonMinterConfigToCell(config);
    const init = { code, data };
    return new JettonMinter(contractAddress(workchain, init), init);
  }

  async sendDeploy(provider: ContractProvider, via: Sender, value: bigint) {
    await provider.internal(via, {
      value,
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body: beginCell().endCell(),
    });
  }

  protected static jettonInternalTransfer(
    jetton_amount: bigint,
    forward_ton_amount: bigint,
    response_addr?: Address,
    query_id: number | bigint = 0,
  ) {
    return beginCell()
      .storeUint(Op.internal_transfer, 32)
      .storeUint(query_id, 64)
      .storeCoins(jetton_amount)
      .storeAddress(null)
      .storeAddress(response_addr)
      .storeCoins(forward_ton_amount)
      .storeBit(false)
      .endCell();
  }
  static mintMessage(to: Address, jetton_amount: bigint, query_id: number | bigint = 0) {
    return beginCell()
      .storeUint(Op.mint, 32)
      .storeUint(query_id, 64) // op, queryId
      .storeAddress(to)
      .storeCoins(toNano(0.2)) // gas fee
      .storeRef(
        // internal transfer message
        beginCell()
          .storeUint(Op.internal_transfer, 32)
          .storeUint(0, 64)
          .storeCoins(jetton_amount)
          .storeAddress(null)
          .storeAddress(null)
          .storeCoins(0)
          .storeBit(false)
          .endCell(),
      )
      .endCell();
  }
  async sendMint(provider: ContractProvider, via: Sender, to: Address, jetton_amount: bigint, value: bigint) {
    await provider.internal(via, {
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body: JettonMinter.mintMessage(to, jetton_amount),
      value,
    });
  }

  /* provide_wallet_address#2c76b973 query_id:uint64 owner_address:MsgAddress include_address:Bool = InternalMsgBody;
   */
  static discoveryMessage(owner: Address, include_address: boolean) {
    return beginCell()
      .storeUint(Op.provide_wallet_address, 32)
      .storeUint(0, 64) // op, queryId
      .storeAddress(owner)
      .storeBit(include_address)
      .endCell();
  }

  async sendDiscovery(
    provider: ContractProvider,
    via: Sender,
    owner: Address,
    include_address: boolean,
    value: bigint = toNano('0.1'),
  ) {
    await provider.internal(via, {
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body: JettonMinter.discoveryMessage(owner, include_address),
      value: value,
    });
  }

  static changeAdminMessage(newOwner: Address) {
    return beginCell()
      .storeUint(Op.change_admin, 32)
      .storeUint(0, 64) // op, queryId
      .storeAddress(newOwner)
      .endCell();
  }

  async sendChangeAdmin(provider: ContractProvider, via: Sender, newOwner: Address) {
    await provider.internal(via, {
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body: JettonMinter.changeAdminMessage(newOwner),
      value: toNano('0.05'),
    });
  }
  static changeContentMessage(content: Cell) {
    return beginCell()
      .storeUint(Op.change_content, 32)
      .storeUint(0, 64) // op, queryId
      .storeRef(content)
      .endCell();
  }

  async sendChangeContent(provider: ContractProvider, via: Sender, content: Cell) {
    await provider.internal(via, {
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body: JettonMinter.changeContentMessage(content),
      value: toNano('0.05'),
    });
  }
  async getWalletAddress(provider: ContractProvider, owner: Address): Promise<Address> {
    const res = await provider.get('get_wallet_address', [
      { type: 'slice', cell: beginCell().storeAddress(owner).endCell() },
    ]);
    return res.stack.readAddress();
  }

  async getJettonData(provider: ContractProvider) {
    let res = await provider.get('get_jetton_data', []);
    let totalSupply = res.stack.readBigNumber();
    let mintable = res.stack.readBoolean();
    let adminAddress = res.stack.readAddress();
    let content = res.stack.readCell();
    let walletCode = res.stack.readCell();
    return {
      totalSupply,
      mintable,
      adminAddress,
      content,
      walletCode,
    };
  }

  async getTotalSupply(provider: ContractProvider) {
    let res = await this.getJettonData(provider);
    return res.totalSupply;
  }
  async getAdminAddress(provider: ContractProvider) {
    let res = await this.getJettonData(provider);
    return res.adminAddress;
  }
  async getContent(provider: ContractProvider) {
    let res = await this.getJettonData(provider);
    return res.content;
  }
}
