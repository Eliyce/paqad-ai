import { sha256 } from '@/rule-scripts/rule-id.js';

export type ShippedWorkflowEntryKind = 'instructions' | 'read';

type ShippedWorkflowEntries = Readonly<
  Record<string, Readonly<Record<ShippedWorkflowEntryKind, readonly string[]>>>
>;

export const SHIPPED_WORKFLOW_ENTRIES: ShippedWorkflowEntries = {
  planning: {
    instructions: [
      '1ce8f3f499cc5a5267623630d547768356826ee48fa3f6939c5a27b35b15e710',
      '4ac7fc9778c4d77ca202fc3b2afe89b6d68e43e27ebc3824ace073009c7be832',
      '801c0bf826abd37e4a1e6ed8934d437ef2030f4cd6d88024c22e6e9a5fc6e71c',
      '86357b5b4233ab4e27a9bb572e0234f68e97fa2f62064c66ba9936576a5167fa',
      '953b0a9f2c917ea7faccb94ee7cd42483d93891b09c498e55ff8269c23f7b471',
      '9f92289c7056056a7b814a32664c50c8c9adfd0cc95c04067641c7a0adf4c1a1',
      'b9edc7bb3de249a381045afde243b6e3b5a5c26c6ee96c6a2108068f9b469082',
      'd34df5e908bc5992c57445d030247f9d6c154b867c31b01e76ab464f31aa03a0',
    ],
    read: [
      '02bf4e6b7ed51d19105fe1b389d85257a342c6b73123e5321cca2e50937e5038',
      '8daefb2f7279a537d6a6dd0ce581c53d2bf2715ff67057971b0b49ed3fef249a',
      'b3e3a3470b3aa727e195b77e3a02e398f0ca24f7ffa1fb58466644ad6986b890',
      'b94631224b0529bde91a072aad18f43434fadd4f9ceab0ec64da9c1b5f4c86c6',
      'c4f52b341a4c444d443e1177c0bc3194f4d8b3ca3b48c709451ec39483b8c879',
    ],
  },
  specification: {
    instructions: [
      '0d4a03cc5b195c308e0657bea295d09fdff2ab1d7d904a5c2179f9057f7c2ff3',
      '10a1dfb39538be6e02a361bf0a55bcb7ee08f00a3cd98a0d0b3ca4dbfd9032b1',
      '203d9aa128fa6555f1c39cbbe49c7b41797c0ad7694f7485a17d2347b26d28f9',
      '287c4e725cc0ea6602521ae246ce787acc98c9f47dd6d82dc141f8c040d0252a',
      '3cd393226ceb6a21936d1c8249f72fc17061721518a057d03f7c42e773dcece4',
      '529e23092769803d8abcdd81bbec3959596d727dddfa6e9007599b6afed47e8e',
      '728d8fd32f0465fd951c14b4bc95979876809810d2b1fd02210bce79e07bc3ff',
      '939fe17663c07f5a0ddcdb7cbd80a5b8b08b1b5c583c47ff231b996ac0f5fbd6',
      'a4eab722e1a0d1390a82be87ab9c7259c920793a63502f030e378c26b8938e18',
      'cbbed688f3db1e4f25bdc05e51ea3651db95a0367830143a2158676279e80f8b',
      'e6904489526866e2ee5d4b4e3947a1f43084efb054d4ef556eadc62f4d31b76e',
      'f5ea78cf17a527ce8932d0a8483914fbd540c799da8d301aa1a3ba7ceeff88c0',
      'f66116ac7ecbbb9e81e703e4b604cd6e1780f57edd5ff9630c6db8954063209f',
    ],
    read: [],
  },
  development: {
    instructions: [
      '18bec3d3df0a86532aaef48f127be9cfa04c9ca5e5b28d832cf89266664d586e',
      '8b0328fc2eea65470223ddebf2142d30d71997e3c2c11a70262d6ab217b43ad9',
    ],
    read: [],
  },
  review: {
    instructions: [
      '0bc2c195b12572c21f8638f4b5f1124a7844977880387c401ce9bda3f53a3f8a',
      '3b5bc059c24e85b6170ed7f9ab24b4673b399774b02e0a61cbeac905196c65d6',
      '424432a63dd68339b6c75897fbc327d982dd7d971a24c01e7542171180759f80',
      '5cbbdcd40026ab0a53b0f855cfbeb4181ccc50802d4ae3e20d185829d8e8a5c7',
      '7db7c7cdce46aed7d8c3c954949a7193e54b8469a57310614a6ebdf1049b35c7',
      '7f71e64ffc7ee311aca8d75cb2087352310eb166d677410ac0d5a00d4129491c',
      'b6dac6bab99a4dc745899077e5c9c814b7a4656e5d92758ec81dd8330e66a170',
      'd747c93f72d9e7e0a638af87c44ad512f5b23e01eda225a983c73d66e6145ad1',
    ],
    read: [],
  },
  checks: {
    instructions: [
      '238d233be61e4e65a462668e5109f13b0619cc8d9edc98b632a1fe078297dcb1',
      '342b23d279474ca2e3bf6641a395adfc0a6803551688335cc1d4566309b22aa0',
      '38e05f96b31def89ce66f6a5bca68bbe85e4a8e3e20946d1532f25f187f5e0a2',
      '8ec76a52b7876ab63f4c9219500fe20f623f2ab07185d6de5694a4865dd2e416',
      'a0a8c6a4596311bb628496c38c10cc63aa92d0015df65d50969864c498feae0a',
    ],
    read: [],
  },
  documentation_sync: {
    instructions: [
      '7db7c7cdce46aed7d8c3c954949a7193e54b8469a57310614a6ebdf1049b35c7',
      'ddbf78cb3f2699e57d80a4210e1a7d9ef5aa4d78ebd3b00efdbad10efd17a3df',
    ],
    read: [],
  },
  delivery: {
    instructions: [
      '21b327f17a4bb4923eb45d6a216195f8f86d4e4aa636697871b5a9bf4674c9e3',
      '285f9aa79338ed6576c4bc2852aeb043f3591c8f8378ffcd76b388d7c14332da',
      '45a534df9df405f749724f6142dee5873e7dc974a2c532b8ded8501475db4bd9',
      '552c7b75a38d6d34acaeaf0561cd1c847e7826b1b3e4c3dc22d2cc2d42c1ddcc',
      '5820e2202c597bb227312c97dd40f4f586d75cd4269434f737efbc571e7b4470',
      '595ceba7e0d78777470363549de32c2ec261d2e0c87ba6fcab9619b4aadecfaa',
      '77f53599ec7c91502c606159ea939e2803c2ddf37db7cc806feda675474da963',
      '89b4e07519330bf528e0ac5e7e0cfb80e9a44327fe49b0935bc0970f06fd8001',
      '90123dbdbb99e7032e9fa72dd5dd1f06b98b2ef9de2c9fd56a938a8d8a00cd93',
      '907f052ae5105d0456b0b2cbc3e3d12a394619feb98465ce5b055f75301c0c72',
      'a210482935ffaaa7c963f68df4da024269a688737908ed1f49f5d4e7dec68686',
      'a8e228db0a4661bb322500775fe3a3912ee27c32d3a3bff164ef0f8929b55c2b',
      'a9bcfa8a946a60fc63652b1cebf94f027fadccafa858c6ed935138076b345bb4',
      'ac380805692d109f30877e9e64aa51ece5d9ba34d0b4a36c7c75635d6936dde5',
      'c4cdd933749cf03a0e20622b2624dcc845c412796bf95bb8083561bb0da2567c',
      'c8d1d37d06dbe9787a2927ca4da52769948aed0b505001697c4103a933242031',
      'ef2c3235d3fc88d81d3c4c00d5a20eb8e8eb4351752ddf79f4169d7f91c1c47d',
      'f977c930cbaae29482f3e9941094ef7184c012b3e47d9864bd3cb6485df96b77',
    ],
    read: [],
  },
};

export function shippedWorkflowEntryHash(text: string): string {
  return sha256(text.replace(/\s+/gu, ' ').trim());
}

export function isShippedWorkflowEntry(
  stage: string,
  kind: ShippedWorkflowEntryKind,
  text: string,
): boolean {
  return SHIPPED_WORKFLOW_ENTRIES[stage]?.[kind].includes(shippedWorkflowEntryHash(text)) === true;
}
