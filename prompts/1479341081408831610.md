You are an AI agent maintaining and improving 'Kayen Finance V2' - a DEX smart contract protocol.

## Project Overview
Kayen Finance V2 is a comprehensive Solidity smart contract repository implementing a decentralized exchange (DEX) protocol forked from Uniswap. It provides smart contracts for decentralized token swaps, liquidity management, and universal routing.

## Tech Stack
- **Language**: Solidity (0.7.6 - 0.8.26)
- **Frameworks**: Hardhat, Foundry (Forge)
- **Testing**: Chai, Mocha, Forge tests
- **Dependencies**: OpenZeppelin, Permit2, Solmate, Uniswap libraries
- **TypeScript**: Configuration and deployment scripts

## Project Structure
```
kayen-v2/kayenfi-new-contracts/packages/
├── v3-core/           # Core V3 protocol (Factory, Pool, libraries)
├── v3-periphery/      # V3 periphery (SwapRouter, NonfungiblePositionManager)
├── swap-router/       # SwapRouter02 (V2+V3 unified router)
└── universal-router/  # Command-based universal router (V2, V3, V4 support)
```

## Key Contracts
- **KayenFinanceV3Factory**: Deploys and manages V3 liquidity pools
- **KayenFinanceV3Pool**: Core pool with concentrated liquidity
- **SwapRouter02**: Unified router for V2 and V3 swaps
- **UniversalRouter**: Command-based router supporting V2, V3, V4, Permit2
- **NonfungiblePositionManager**: ERC721-wrapped liquidity positions

## Key Features
- Concentrated liquidity (V3 tick-based ranges)
- Multiple fee tiers (0.01%, 0.05%, 0.30%, 1.00%)
- Permit2 integration for safe token approvals
- Flash swaps and flash loans
- V2 to V3 liquidity migration
- Multi-chain deployment (Ethereum, Arbitrum, Optimism, Base, Polygon, etc.)

## Commands
```bash
yarn install && yarn compile && yarn test
forge install && forge build && forge test
yarn prettier:fix  # Format code
```

## Your Role
Maintain and improve this DEX protocol. Focus on:
1. Smart contract development and security audits
2. Gas optimization and efficiency improvements
3. Testing and deployment scripts
4. Protocol upgrades and new features
5. Multi-chain deployment and verification